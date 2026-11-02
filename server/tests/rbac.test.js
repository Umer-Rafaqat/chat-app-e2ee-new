/*
 * Authorization tests for roles / admin APIs / admin WebSocket events.
 *
 * Runs with the built-in Node test runner:  npm test
 * MongoDB is replaced by a tiny in-memory fake (see FAKE DB below) so the
 * suite exercises the REAL middleware, routes, controllers, services and
 * WebSocket server — only the persistence layer is faked.
 */
process.env.MONGO_URI = "mongodb://fake/db";
process.env.JWT_SECRET = "test-secret";
process.env.FIREBASE_PROJECT_ID = "x";
process.env.FIREBASE_CLIENT_EMAIL = "x@x";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "x";
process.env.CLOUDINARY_API_SECRET = "x";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");
const WebSocket = require("ws");

// Firebase can't initialise with fake credentials; push isn't under test.
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

/* ------------------------------ FAKE DB ------------------------------ */
const oid = () => new mongoose.Types.ObjectId();
const users = new Map();
const convs = new Map();

// Minimal chainable, awaitable query.
const query = (getValue) => {
  const q = {
    select: () => q,
    populate: () => q,
    sort: () => q,
    skip: () => q,
    limit: () => q,
    distinct: async () => (await getValue()).map((d) => d._id),
    then: (res, rej) => Promise.resolve(getValue()).then(res, rej),
  };
  return q;
};

const publicUser = (u) => ({ _id: u._id, name: u.name, email: u.email });
const withMembers = (c) => ({
  ...c,
  participants: c.participants.map((id) => publicUser(users.get(String(id)))),
});

function makeUser(name, role = "user", extra = {}) {
  const u = {
    _id: oid(),
    name,
    email: `${name}@test.com`,
    role,
    accountDisabled: false,
    save: async () => {},
    ...extra,
  };
  users.set(String(u._id), u);
  return u;
}
const tokenFor = (u) => jwt.sign({ id: String(u._id) }, "test-secret");
const cookieFor = (u) => `token=${tokenFor(u)}`;

User.findById = (id) => query(() => users.get(String(id)) || null);
User.findOne = (f) =>
  query(() => [...users.values()].find((u) => u.email === f.email) || null);
User.find = (f = {}) =>
  query(() =>
    [...users.values()].filter(
      (u) =>
        (!f.role || u.role === f.role) &&
        (f.accountDisabled === undefined || u.accountDisabled === f.accountDisabled),
    ),
  );
User.countDocuments = async (f = {}) => {
  if (f._id?.$in) {
    return f._id.$in.filter((id) => {
      const u = users.get(String(id));
      return u && u.accountDisabled === f.accountDisabled;
    }).length;
  }
  return [...users.values()].filter((u) => !f.role || u.role === f.role).length;
};
User.create = async (data) => {
  const u = makeUser(data.email.split("@")[0], data.role ?? "user");
  Object.assign(u, data);
  return u;
};
User.findByIdAndUpdate = (id, update) =>
  query(() => {
    const u = users.get(String(id));
    if (u) Object.assign(u, update);
    return u || null;
  });

Conversation.create = async (data) => {
  const c = { _id: oid(), ...data, participants: data.participants.map(String) };
  convs.set(String(c._id), c);
  return { ...c, populate: async () => withMembers(c) };
};
Conversation.find = () =>
  query(() => [...convs.values()].filter((c) => c.isGroup).map(withMembers));
Conversation.countDocuments = async () => convs.size;
Conversation.findById = (id) =>
  query(() => {
    const c = convs.get(String(id));
    if (!c) return null;
    return {
      ...c,
      participants: c.participants.map((pid) => ({
        ...publicUser(users.get(pid)),
        _id: new mongoose.Types.ObjectId(pid),
      })),
    };
  });
Conversation.findOneAndUpdate = (f, update) =>
  query(() => {
    const c = convs.get(String(f._id));
    if (!c || c.isGroup !== f.isGroup) return null;
    Object.assign(c, update);
    return withMembers(c);
  });
Conversation.findOneAndDelete = async (f) => {
  const c = convs.get(String(f._id));
  if (!c || c.isGroup !== f.isGroup) return null;
  convs.delete(String(c._id));
  return { ...c, _id: new mongoose.Types.ObjectId(c._id) };
};
Message.deleteMany = async () => {};
Message.countDocuments = async () => 0;
Notification.deleteMany = async () => {};

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

const admin = makeUser("admin", "admin");
const alice = makeUser("alice");
const bob = makeUser("bob");
const api = () => request(server);
const as = (u) => ({ Cookie: cookieFor(u) });

/* ------------------------------ HTTP: auth ------------------------------ */
test("GET /health is public and does not require a database", async () => {
  const res = await api().get("/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("image upload returns Cloudinary secure_url in the existing response shape", async () => {
  const cloudinary = require("../config/cloudinary");
  const originalUploadStream = cloudinary.uploader.upload_stream;
  const imageUrl = "https://res.cloudinary.com/test-cloud/image/upload/test.png";

  cloudinary.uploader.upload_stream = (options, callback) => {
    assert.equal(options.folder, "chat-app");
    return {
      end(buffer) {
        assert.ok(Buffer.isBuffer(buffer));
        callback(null, { secure_url: imageUrl });
      },
    };
  };

  try {
    const res = await api()
      .post(`/api/conversations/${someId}/messages/upload`)
      .set(as(alice))
      .attach("image", Buffer.from("image"), {
        filename: "image.png",
        contentType: "image/png",
      });

    assert.equal(res.status, 201);
    assert.deepEqual(res.body, {
      success: true,
      data: { imageUrl },
    });
  } finally {
    cloudinary.uploader.upload_stream = originalUploadStream;
  }
});

test("signup always creates role=user, even if body asks for admin", async () => {
  const res = await api()
    .post("/api/auth/register")
    .send({ name: "Mallory", email: "mallory@test.com", password: "password123", role: "admin" });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.role, "user");
  assert.equal(users.get(String(res.body.data.id)).role, "user");
});

test("GET /api/auth/me returns the role stored in the database", async () => {
  const a = await api().get("/api/auth/me").set(as(admin));
  const u = await api().get("/api/auth/me").set(as(alice));
  assert.equal(a.body.data.role, "admin");
  assert.equal(u.body.data.role, "user");
});

test("a token cannot carry its own role (payload role is ignored)", async () => {
  const forged = jwt.sign({ id: String(alice._id), role: "admin" }, "test-secret");
  const res = await api().post("/api/conversations/group").set("Cookie", `token=${forged}`)
    .send({ name: "x", participantIds: [String(bob._id)] });
  assert.equal(res.status, 403);
});

test("disabled account is rejected on every request (403)", async () => {
  const eve = makeUser("eve", "user", { accountDisabled: true });
  const res = await api().get("/api/conversations").set(as(eve));
  assert.equal(res.status, 403);
});

test("image upload rejects unsupported MIME types", async () => {
  const res = await api()
    .post(`/api/conversations/${someId}/messages/upload`)
    .set(as(alice))
    .attach("image", Buffer.from("not an image"), {
      filename: "image.svg",
      contentType: "image/svg+xml",
    });

  assert.equal(res.status, 400);
  assert.equal(
    res.body.message,
    "Only JPEG, PNG, WebP, and GIF images are allowed",
  );
});

test("image upload rejects files larger than 4MB", async () => {
  const res = await api()
    .post(`/api/conversations/${someId}/messages/upload`)
    .set(as(alice))
    .attach("image", Buffer.alloc(4 * 1024 * 1024 + 1), {
      filename: "image.png",
      contentType: "image/png",
    });

  assert.equal(res.status, 413);
  assert.equal(res.body.message, "Image must be 4MB or smaller");
});

/* ------------------- HTTP: admin-only endpoints (matrix) ------------------- */
const someId = "a".repeat(24);
const adminOnly = [
  ["post", "/api/conversations/group", { name: "G", participantIds: [someId] }],
  ["patch", `/api/conversations/${someId}`, { name: "N" }],
  ["delete", `/api/conversations/${someId}`, undefined],
  ["get", "/api/admin/stats"],
  ["get", "/api/admin/users"],
  ["get", `/api/admin/users/${someId}`],
  ["patch", `/api/admin/users/${someId}/status`, { accountDisabled: true }],
  ["patch", `/api/admin/users/${someId}/role`, { role: "admin" }],
  ["get", "/api/admin/groups"],
];

for (const [method, url, body] of adminOnly) {
  test(`401 without login: ${method.toUpperCase()} ${url.replace(someId, ":id")}`, async () => {
    const res = await api()[method](url).send(body);
    assert.equal(res.status, 401);
  });
  test(`403 for normal user: ${method.toUpperCase()} ${url.replace(someId, ":id")}`, async () => {
    const res = await api()[method](url).set(as(alice)).send(body);
    assert.equal(res.status, 403);
  });
}

test("normal user is 403 (not 400) even with an invalid body — role checked first", async () => {
  const res = await api().post("/api/conversations/group").set(as(alice)).send({});
  assert.equal(res.status, 403);
});

test("normal user can still list their conversations", async () => {
  const res = await api().get("/api/conversations").set(as(alice));
  assert.equal(res.status, 200);
});

/* ------------------------ HTTP: admin happy path ------------------------ */
let groupId;
test("admin creates, renames, lists and deletes a group", async () => {
  const created = await api().post("/api/conversations/group").set(as(admin))
    .send({ name: "Team", participantIds: [String(alice._id)] });
  assert.equal(created.status, 201);
  groupId = created.body.data._id;
  assert.equal(created.body.data.isGroup, true);

  const renamed = await api().patch(`/api/conversations/${groupId}`).set(as(admin)).send({ name: "Renamed" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.name, "Renamed");

  const list = await api().get("/api/admin/groups").set(as(admin));
  assert.equal(list.status, 200);
  assert.ok(list.body.data.some((g) => g._id === groupId));

  const deleted = await api().delete(`/api/conversations/${groupId}`).set(as(admin));
  assert.equal(deleted.status, 200);
  const again = await api().delete(`/api/conversations/${groupId}`).set(as(admin));
  assert.equal(again.status, 404);
});

test("admin input validation: bad name / bad ids / unknown members", async () => {
  const noName = await api().post("/api/conversations/group").set(as(admin)).send({ name: " ", participantIds: [String(alice._id)] });
  assert.equal(noName.status, 400);
  const badId = await api().patch("/api/conversations/not-an-id").set(as(admin)).send({ name: "x" });
  assert.equal(badId.status, 400);
  const ghost = await api().post("/api/conversations/group").set(as(admin)).send({ name: "G", participantIds: [someId] });
  assert.equal(ghost.status, 400);
});

test("admin can change another user's role/status, but not their own", async () => {
  const self = await api().patch(`/api/admin/users/${admin._id}/role`).set(as(admin)).send({ role: "user" });
  assert.equal(self.status, 400);
  const selfStatus = await api().patch(`/api/admin/users/${admin._id}/status`).set(as(admin)).send({ accountDisabled: true });
  assert.equal(selfStatus.status, 400);
  const badRole = await api().patch(`/api/admin/users/${bob._id}/role`).set(as(admin)).send({ role: "superuser" });
  assert.equal(badRole.status, 400);

  const promoted = await api().patch(`/api/admin/users/${bob._id}/role`).set(as(admin)).send({ role: "admin" });
  assert.equal(promoted.status, 200);
  assert.equal(users.get(String(bob._id)).role, "admin");
  await api().patch(`/api/admin/users/${bob._id}/role`).set(as(admin)).send({ role: "user" });

  const disabled = await api().patch(`/api/admin/users/${bob._id}/status`).set(as(admin)).send({ accountDisabled: true });
  assert.equal(disabled.status, 200);
  assert.equal((await api().get("/api/conversations").set(as(bob))).status, 403);
  await api().patch(`/api/admin/users/${bob._id}/status`).set(as(admin)).send({ accountDisabled: false });
  assert.equal((await api().get("/api/conversations").set(as(bob))).status, 200);
});

/* --------------------------- WebSocket events --------------------------- */
function connect(user) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, {
      headers: {
        Cookie: cookieFor(user),
        Origin: "http://localhost:5173",
      },
    });
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

test("WS: connection without a valid cookie is rejected", async () => {
  await assert.rejects(new Promise((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${port}`, {
      headers: { Origin: "http://localhost:5173" },
    });
    ws.on("open", res); ws.on("error", rej);
  }));
});

test("WS: null JSON payload returns an error without closing the connection", async () => {
  const ws = await connect(alice);
  ws.send("null");

  const response = await waitFor(ws, (message) => message.type === "error");
  assert.equal(response?.data.message, "Message payload must be an object");
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
});

test("WS: rejects image URLs that are not hosted by the configured Cloudinary cloud", async () => {
  const ws = await connect(alice);
  ws.send(
    JSON.stringify({
      type: "image",
      conversationId: String(new mongoose.Types.ObjectId()),
      data: { imageUrl: "https://example.com/image.png" },
    }),
  );

  const response = await waitFor(ws, (message) => message.type === "error");
  assert.equal(response?.data.message, "A valid Cloudinary image URL is required");
  ws.close();
});

test("WS: normal user's group:create/update/delete are rejected with 403 (payload role ignored)", async () => {
  const before = convs.size;
  const ws = await connect(alice);
  ws.send(JSON.stringify({ type: "group:create", role: "admin", data: { role: "admin", name: "Hack", participantIds: [String(bob._id)] } }));
  const e1 = await waitFor(ws, (m) => m.type === "error" && m.data.event === "group:create");
  assert.equal(e1?.data.status, 403);

  ws.send(JSON.stringify({ type: "group:update", conversationId: someId, data: { name: "x" } }));
  assert.equal((await waitFor(ws, (m) => m.data?.event === "group:update"))?.data.status, 403);
  ws.send(JSON.stringify({ type: "group:delete", conversationId: someId }));
  assert.equal((await waitFor(ws, (m) => m.data?.event === "group:delete"))?.data.status, 403);

  assert.equal(convs.size, before, "no group was created");
  ws.close();
});

test("WS: admin group events persist and broadcast to members + admins only", async () => {
  const wsAdmin = await connect(admin);
  const wsAlice = await connect(alice);
  const wsBob = await connect(bob); // not a member

  wsAdmin.send(JSON.stringify({ type: "group:create", data: { name: "Live", participantIds: [String(alice._id)] } }));
  const createdForAlice = await waitFor(wsAlice, (m) => m.type === "group:created");
  assert.ok(createdForAlice, "member receives group:created");
  assert.ok(await waitFor(wsAdmin, (m) => m.type === "group:created"), "admin receives it too");
  const id = String(createdForAlice.data._id);

  wsAdmin.send(JSON.stringify({ type: "group:update", conversationId: id, data: { name: "Live2" } }));
  const upd = await waitFor(wsAlice, (m) => m.type === "group:updated");
  assert.equal(upd.data.name, "Live2");

  wsAdmin.send(JSON.stringify({ type: "group:delete", conversationId: id }));
  const del = await waitFor(wsAlice, (m) => m.type === "group:deleted");
  assert.equal(del.data.conversationId, id);
  assert.equal(convs.has(id), false);

  assert.equal(wsBob.inbox.some((m) => m.type?.startsWith("group:")), false, "non-member gets nothing");
  [wsAdmin, wsAlice, wsBob].forEach((w) => w.close());
});

test("WS: role is re-read from the DB on each event (demoted admin loses access mid-session)", async () => {
  const temp = makeUser("temp", "admin");
  const ws = await connect(temp);
  ws.send(JSON.stringify({ type: "group:create", data: { name: "One", participantIds: [String(alice._id)] } }));
  assert.ok(await waitFor(ws, (m) => m.type === "group:created"));

  temp.role = "user"; // demoted while still connected
  ws.send(JSON.stringify({ type: "group:create", data: { name: "Two", participantIds: [String(alice._id)] } }));
  const err = await waitFor(ws, (m) => m.type === "error" && m.data.event === "group:create");
  assert.equal(err?.data.status, 403);
  ws.close();
});

test("WS: disabling a user force-closes their socket", async () => {
  const victim = makeUser("victim");
  const ws = await connect(victim);
  const closed = new Promise((r) => ws.on("close", (code) => r(code)));
  await api().patch(`/api/admin/users/${victim._id}/status`).set(as(admin)).send({ accountDisabled: true });
  assert.equal(await closed, 4003);
});

test("WS: existing conversation:open still works for a normal member", async () => {
  const g = await Conversation.create({ name: "Open", participants: [String(admin._id), String(alice._id)], isGroup: true });
  const ws = await connect(alice);
  ws.send(JSON.stringify({ type: "conversation:open", conversationId: String(g._id) }));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(ws.inbox.some((m) => m.type === "error"), false);
  ws.close();
});
