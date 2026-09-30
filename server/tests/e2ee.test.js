/*
 * End-to-end encryption tests.
 *
 * Two "clients" in this file use the REAL Web Crypto API (Node's global
 * `crypto.subtle`, same interface the browser exposes) to do actual ECDH +
 * AES-GCM — this isn't a mock of the crypto, only the database is faked.
 * That means these tests prove the wire protocol genuinely round-trips:
 * what one browser encrypts, another browser (with the right private key)
 * can decrypt, and the server in between only ever handles ciphertext.
 */
process.env.MONGO_URI = "mongodb://fake/db";
process.env.JWT_SECRET = "test-secret";
process.env.FIREBASE_PROJECT_ID = "x";
process.env.FIREBASE_CLIENT_EMAIL = "x@x";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");
const WebSocket = require("ws");

const firebasePath = require.resolve("../config/firebase");
require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: { firebaseApp: {}, firebaseMessaging: {} },
};

const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const FcmInstallation = require("../models/FcmInstallation");

/* ------------------------------ FAKE DB ------------------------------ */
const oid = () => new mongoose.Types.ObjectId();
const users = new Map();
const convs = new Map();
const messages = new Map();

const query = (getValue) => {
  const q = {
    select: () => q,
    populate: () => q,
    sort: () => q,
    distinct: async () => (await getValue()).map((d) => d._id),
    then: (res, rej) => Promise.resolve(getValue()).then(res, rej),
  };
  return q;
};

const publicUser = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  publicKey: u.publicKey ?? null,
});
const withMembers = (c) => ({
  ...c,
  participants: c.participants.map((id) => publicUser(users.get(String(id)))),
});

function makeUser(name) {
  const u = { _id: oid(), name, email: `${name}@test.com`, role: "user", accountDisabled: false, publicKey: null };
  users.set(String(u._id), u);
  return u;
}
const tokenFor = (u) => jwt.sign({ id: String(u._id) }, "test-secret");
const cookieFor = (u) => `token=${tokenFor(u)}`;

User.findById = (id) => query(() => users.get(String(id)) || null);
User.find = (f = {}) =>
  query(() =>
    [...users.values()].filter(
      (u) =>
        (!f._id?.$in || f._id.$in.map(String).includes(String(u._id))) &&
        (!f.role || u.role === f.role) &&
        (f.accountDisabled === undefined || u.accountDisabled === f.accountDisabled),
    ),
  );
User.countDocuments = async (f = {}) =>
  f._id?.$in ? f._id.$in.filter((id) => users.get(String(id))?.accountDisabled === false).length : users.size;
User.findByIdAndUpdate = (id, update) =>
  query(() => {
    const u = users.get(String(id));
    if (u) Object.assign(u, update);
    return u ? publicUser(u) : null;
  });

Conversation.create = async (data) => {
  const c = { _id: oid(), ...data, participants: data.participants.map(String) };
  convs.set(String(c._id), c);
  return { ...c, populate: async () => withMembers(c) };
};
Conversation.findOne = (f) =>
  query(() => {
    const wanted = f.participants.map(String).sort().join(",");
    const hit = [...convs.values()].find(
      (c) => c.participants.slice().sort().join(",") === wanted && !c.isGroup,
    );
    return hit ? { ...hit, populate: async () => withMembers(hit) } : null;
  });
Conversation.populate = async (conv) => withMembers(conv);
Conversation.findById = (id) =>
  query(() => {
    const c = convs.get(String(id));
    return c ? withMembers(c) : null;
  });

Message.create = async (data) => {
  const doc = {
    _id: oid(),
    conversation: String(data.conversation),
    sender: String(data.sender),
    content: data.content || "",
    encrypted: Boolean(data.encrypted),
    ciphertext: data.ciphertext || null,
    iv: data.iv || null,
    keys: data.keys || null,
    imageUrl: data.imageUrl || null,
    messageType: data.messageType || "text",
    createdAt: new Date(),
  };
  messages.set(String(doc._id), doc);
  return {
    ...doc,
    populate: async function populate() {
      this.sender = publicUser(users.get(doc.sender));
      return this;
    },
  };
};
Message.find = (f = {}) =>
  query(() =>
    [...messages.values()]
      .filter((m) => !f.conversation || m.conversation === String(f.conversation))
      .map((m) => ({ ...m, sender: publicUser(users.get(m.sender)) })),
  );
Message.deleteMany = async () => {};

Notification.insertMany = async (docs) =>
  docs.map((d) => ({ ...d, _id: oid(), recipient: d.recipient, conversation: d.conversation, message: d.message, createdAt: new Date() }));
Notification.deleteMany = async () => {};

FcmInstallation.find = () => query(() => []);

/* --------------------------- APP UNDER TEST --------------------------- */
const app = require("../app");
const attachWebSocketServer = require("../websocket/websocket.server");
const server = http.createServer(app);
attachWebSocketServer(server);

let port;
test.before(async () => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
test.after(() => server.closeAllConnections?.() || server.close());

const api = () => request(server);
const as = (u) => ({ Cookie: cookieFor(u) });

/* ------------------------- crypto test helpers ------------------------- */
// Mirrors client/src/lib/e2ee.js exactly, minus IndexedDB (an in-memory
// key pair stands in for "this browser's stored identity").
const ECDH_PARAMS = { name: "ECDH", namedCurve: "P-256" };
const AES_PARAMS = { name: "AES-GCM", length: 256 };

const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (str) => Uint8Array.from(Buffer.from(str, "base64")).buffer;

async function makeIdentity() {
  const pair = await crypto.subtle.generateKey(ECDH_PARAMS, true, ["deriveKey", "deriveBits"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicKeyJwk };
}

async function deriveWrappingKey(myPrivateKey, peerJwk) {
  const peerKey = await crypto.subtle.importKey("jwk", peerJwk, ECDH_PARAMS, true, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: peerKey }, myPrivateKey, AES_PARAMS, false, ["encrypt", "decrypt"]);
}

// participants: [{ userId, publicKey: jwk }]
async function encryptForParticipants(plaintext, senderPrivateKey, participants) {
  const messageKey = await crypto.subtle.generateKey(AES_PARAMS, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, messageKey, new TextEncoder().encode(plaintext));
  const rawKey = await crypto.subtle.exportKey("raw", messageKey);

  const keys = {};
  for (const p of participants) {
    const wrapKey = await deriveWrappingKey(senderPrivateKey, p.publicKey);
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv }, wrapKey, rawKey);
    keys[p.userId] = { wrappedKey: b64(wrapped), iv: b64(wrapIv) };
  }
  return { encrypted: true, ciphertext: b64(ciphertext), iv: b64(iv), keys };
}

async function decryptAsRecipient(message, myPrivateKey, myUserId, senderPublicKeyJwk) {
  const entry = message.keys[myUserId];
  const wrapKey = await deriveWrappingKey(myPrivateKey, senderPublicKeyJwk);
  const rawKey = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(entry.iv) }, wrapKey, unb64(entry.wrappedKey));
  const messageKey = await crypto.subtle.importKey("raw", rawKey, AES_PARAMS, false, ["decrypt"]);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(message.iv) }, messageKey, unb64(message.ciphertext));
  return new TextDecoder().decode(plainBuf);
}

function connect(user) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, { headers: { Cookie: cookieFor(user) } });
    ws.inbox = [];
    ws.on("message", (raw) => ws.inbox.push(JSON.parse(raw.toString())));
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}
const waitFor = async (ws, pred, ms = 1500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = ws.inbox.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 15));
  }
  return null;
};

/* ------------------------------ tests ------------------------------ */

test("public key upload: requires auth, validates shape, is readable by others", async () => {
  const alice = makeUser("pk-alice");
  const { publicKeyJwk } = await makeIdentity();

  const noAuth = await api().put("/api/users/me/public-key").send({ publicKey: publicKeyJwk });
  assert.equal(noAuth.status, 401);

  const badShape = await api().put("/api/users/me/public-key").set(as(alice)).send({ publicKey: { kty: "EC" } });
  assert.equal(badShape.status, 400);

  const ok = await api().put("/api/users/me/public-key").set(as(alice)).send({ publicKey: publicKeyJwk });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.publicKey.x, publicKeyJwk.x);

  const seenByOther = await api().get(`/api/users/${alice._id}`).set(as(makeUser("pk-viewer")));
  assert.equal(seenByOther.body.data.publicKey.x, publicKeyJwk.x);
});

test("1-on-1: message is stored/relayed as ciphertext only, and both ends can decrypt it", async () => {
  const alice = makeUser("dm-alice");
  const bob = makeUser("dm-bob");
  const aliceId = await makeIdentity();
  const bobId = await makeIdentity();
  await api().put("/api/users/me/public-key").set(as(alice)).send({ publicKey: aliceId.publicKeyJwk });
  await api().put("/api/users/me/public-key").set(as(bob)).send({ publicKey: bobId.publicKeyJwk });

  const conv = await api().post("/api/conversations").set(as(alice)).send({ participantId: String(bob._id) });
  assert.equal(conv.status, 200);

  const wsAlice = await connect(alice);
  const wsBob = await connect(bob);

  const plaintext = "Hey Bob, are we still on for 5pm?";
  const participants = [
    { userId: String(alice._id), publicKey: aliceId.publicKeyJwk },
    { userId: String(bob._id), publicKey: bobId.publicKeyJwk },
  ];
  const payload = await encryptForParticipants(plaintext, aliceId.privateKey, participants);

  wsAlice.send(JSON.stringify({ type: "message", conversationId: conv.body.data._id, data: payload }));

  const receivedByBob = await waitFor(wsBob, (m) => m.type === "message");
  assert.ok(receivedByBob, "Bob receives the message over WebSocket");

  // The server never had a decryption key — prove the wire payload really
  // is ciphertext, not the plaintext with a label slapped on it.
  assert.equal(receivedByBob.data.encrypted, true);
  assert.ok(!receivedByBob.data.ciphertext.toLowerCase().includes("5pm"));
  assert.equal(receivedByBob.data.content, "");

  const decryptedByBob = await decryptAsRecipient(receivedByBob.data, bobId.privateKey, String(bob._id), aliceId.publicKeyJwk);
  assert.equal(decryptedByBob, plaintext);

  // Sender can also decrypt their own sent message later (their own entry
  // in `keys`, wrapped with their own key — a valid ECDH self-derivation).
  const decryptedByAlice = await decryptAsRecipient(receivedByBob.data, aliceId.privateKey, String(alice._id), aliceId.publicKeyJwk);
  assert.equal(decryptedByAlice, plaintext);

  // History fetched over REST carries the same ciphertext, round-trips too.
  const history = await api().get(`/api/conversations/${conv.body.data._id}/messages`).set(as(bob));
  assert.equal(history.status, 200);
  const stored = history.body.data.find((m) => m.encrypted);
  assert.ok(stored);
  assert.equal(stored.content, "");
  const decryptedFromHistory = await decryptAsRecipient(stored, bobId.privateKey, String(bob._id), aliceId.publicKeyJwk);
  assert.equal(decryptedFromHistory, plaintext);

  [wsAlice, wsBob].forEach((w) => w.close());
});

test("group: every current member can decrypt, a message not wrapped for everyone is rejected", async () => {
  const admin = makeUser("grp-admin");
  admin.role = "admin";
  const bob = makeUser("grp-bob");
  const carol = makeUser("grp-carol");
  const identities = {};
  for (const [key, u] of [["admin", admin], ["bob", bob], ["carol", carol]]) {
    identities[key] = await makeIdentity();
    await api().put("/api/users/me/public-key").set(as(u)).send({ publicKey: identities[key].publicKeyJwk });
  }

  const created = await api().post("/api/conversations/group").set(as(admin))
    .send({ name: "Launch Team", participantIds: [String(bob._id), String(carol._id)] });
  assert.equal(created.status, 201);
  const conversationId = created.body.data._id;

  const wsAdmin = await connect(admin);
  const wsBob = await connect(bob);
  const wsCarol = await connect(carol);

  const plaintext = "Deploying at 9am, everyone ready?";
  const allParticipants = [
    { userId: String(admin._id), publicKey: identities.admin.publicKeyJwk },
    { userId: String(bob._id), publicKey: identities.bob.publicKeyJwk },
    { userId: String(carol._id), publicKey: identities.carol.publicKeyJwk },
  ];
  const payload = await encryptForParticipants(plaintext, identities.admin.privateKey, allParticipants);

  wsAdmin.send(JSON.stringify({ type: "message", conversationId, data: payload }));

  const forBob = await waitFor(wsBob, (m) => m.type === "message");
  const forCarol = await waitFor(wsCarol, (m) => m.type === "message");
  assert.ok(forBob && forCarol);

  assert.equal(
    await decryptAsRecipient(forBob.data, identities.bob.privateKey, String(bob._id), identities.admin.publicKeyJwk),
    plaintext,
  );
  assert.equal(
    await decryptAsRecipient(forCarol.data, identities.carol.privateKey, String(carol._id), identities.admin.publicKeyJwk),
    plaintext,
  );

  // Now send again, "forgetting" to wrap a key for Carol — the server must
  // reject this rather than silently store a message she can never read.
  const incompletePayload = await encryptForParticipants(
    "Second message",
    identities.admin.privateKey,
    allParticipants.filter((p) => p.userId !== String(carol._id)),
  );
  const beforeCount = messages.size;
  wsAdmin.send(JSON.stringify({ type: "message", conversationId, data: incompletePayload }));
  const err = await waitFor(wsAdmin, (m) => m.type === "error");
  assert.ok(err);
  assert.match(err.data.message, /every current participant/i);
  assert.equal(messages.size, beforeCount, "the incomplete message was not stored");

  [wsAdmin, wsBob, wsCarol].forEach((w) => w.close());
});

test("an unencrypted text message is rejected — the server never accepts plaintext", async () => {
  const alice = makeUser("plain-alice");
  const bob = makeUser("plain-bob");
  await api().put("/api/users/me/public-key").set(as(alice)).send({ publicKey: (await makeIdentity()).publicKeyJwk });
  const conv = await api().post("/api/conversations").set(as(alice)).send({ participantId: String(bob._id) });

  const ws = await connect(alice);
  const beforeCount = messages.size;
  ws.send(JSON.stringify({ type: "message", conversationId: conv.body.data._id, data: { content: "hi" } }));
  const err = await waitFor(ws, (m) => m.type === "error");
  assert.ok(err);
  assert.match(err.data.message, /must be encrypted/i);
  assert.equal(messages.size, beforeCount);
  ws.close();
});

test("notifications never carry message content for encrypted text (server can't read it)", async () => {
  const alice = makeUser("notif-alice");
  const bob = makeUser("notif-bob");
  const aliceId = await makeIdentity();
  const bobId = await makeIdentity();
  await api().put("/api/users/me/public-key").set(as(alice)).send({ publicKey: aliceId.publicKeyJwk });
  await api().put("/api/users/me/public-key").set(as(bob)).send({ publicKey: bobId.publicKeyJwk });
  const conv = await api().post("/api/conversations").set(as(alice)).send({ participantId: String(bob._id) });

  const wsAlice = await connect(alice);
  const wsBob = await connect(bob);
  // Bob must NOT be "active" in this conversation to get a notification.
  const payload = await encryptForParticipants("Super secret plan", aliceId.privateKey, [
    { userId: String(alice._id), publicKey: aliceId.publicKeyJwk },
    { userId: String(bob._id), publicKey: bobId.publicKeyJwk },
  ]);
  wsAlice.send(JSON.stringify({ type: "message", conversationId: conv.body.data._id, data: payload }));

  const notification = await waitFor(wsBob, (m) => m.type === "notification");
  assert.ok(notification);
  assert.equal(notification.data.content, "New message");
  [wsAlice, wsBob].forEach((w) => w.close());
});
