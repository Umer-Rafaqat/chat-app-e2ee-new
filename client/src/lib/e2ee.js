// End-to-end encryption core.
//
// Design (same code path for 1-on-1 AND group chats — a 1-on-1 chat is
// just a "group" of 2):
//
//   1. Every user has a long-lived ECDH (P-256) identity key pair.
//      - Public half is uploaded to the server and shared with everyone.
//      - Private half NEVER leaves this browser (stored in IndexedDB only).
//
//   2. To send a message, the client:
//      - generates a brand new random AES-256-GCM key ("message key")
//      - encrypts the message text with it
//      - for EVERY current participant (including the sender, so the
//        sender can re-read their own sent messages), derives a shared
//        secret via ECDH(myPrivateKey, participantPublicKey) and uses it
//        to wrap (encrypt) a copy of the message key for that participant
//
//   3. The server stores/relays: ciphertext, iv, and the map of
//      { userId -> wrapped message key }. It never has a private key, so
//      it can never decrypt anything.
//
//   4. To read a message, the recipient's client finds its own wrapped-key
//      entry, derives the SAME shared secret via ECDH(myPrivateKey,
//      senderPublicKey) — ECDH is symmetric, so this matches the sender's
//      derivation — unwraps the message key, then decrypts the text.
//
// Because each message is wrapped independently for whoever is a
// participant AT SEND TIME, this naturally does the right thing for
// groups: a member added later cannot decrypt messages sent before they
// joined, and nothing needs to be "rotated" when membership changes.
//
// Known limitations (documented, not hidden):
//   - One browser = one identity. Logging in on a new device generates a
//     new key pair, which overwrites the old public key on the server.
//     Messages sent before that stay unreadable on the new device — there
//     is no cross-device key sync/backup (yet).
//   - Images are not encrypted (out of scope for this pass).
//   - Message previews (notifications) never contain real content — the
//     server has nothing to show, so this is enforced, not optional.

const DB_NAME = "e2ee-keystore";
const DB_VERSION = 1;
const STORE_NAME = "identity";
const KEY_RECORD_ID = "self";

const ECDH_PARAMS = { name: "ECDH", namedCurve: "P-256" };
const AES_PARAMS = { name: "AES-GCM", length: 256 };
const GCM_IV_BYTES = 12; // 96-bit IV, the recommended size for AES-GCM

// ---------------------------------------------------------------------
// IndexedDB: local-only storage for the private key. Never sent anywhere.
// ---------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------
// Base64 <-> ArrayBuffer helpers (payloads travel over JSON, so binary
// data is base64-encoded).
// ---------------------------------------------------------------------

function bufToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------
// Identity key pair: generate once, cache in IndexedDB, reuse after that.
// ---------------------------------------------------------------------

let cachedKeyPair = null; // in-memory cache for this tab's lifetime

// Returns { privateKey, publicKey } as CryptoKey objects, creating and
// persisting a new pair on first use in this browser.
export async function getOrCreateIdentityKeyPair() {
  if (cachedKeyPair) return cachedKeyPair;

  const stored = await idbGet(KEY_RECORD_ID);

  if (stored) {
    const [privateKey, publicKey] = await Promise.all([
      crypto.subtle.importKey("jwk", stored.privateKey, ECDH_PARAMS, true, [
        "deriveKey",
        "deriveBits",
      ]),
      crypto.subtle.importKey("jwk", stored.publicKey, ECDH_PARAMS, true, []),
    ]);
    cachedKeyPair = { privateKey, publicKey };
    return cachedKeyPair;
  }

  const pair = await crypto.subtle.generateKey(ECDH_PARAMS, true, [
    "deriveKey",
    "deriveBits",
  ]);

  const [privateJwk, publicJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.privateKey),
    crypto.subtle.exportKey("jwk", pair.publicKey),
  ]);

  await idbSet(KEY_RECORD_ID, { privateKey: privateJwk, publicKey: publicJwk });

  cachedKeyPair = pair;
  return cachedKeyPair;
}

// The public key JWK to upload to the server / show to other users.
export async function getMyPublicKeyJwk() {
  const { publicKey } = await getOrCreateIdentityKeyPair();
  return crypto.subtle.exportKey("jwk", publicKey);
}

// Marker so we only upload the public key once per browser per account,
// not on every login. Keyed by user id in case of a shared browser.
export async function hasUploadedPublicKey(userId) {
  return Boolean(await idbGet(`uploaded:${userId}`));
}

export async function markPublicKeyUploaded(userId) {
  return idbSet(`uploaded:${userId}`, true);
}

function importPeerPublicKey(jwk) {
  return crypto.subtle.importKey("jwk", jwk, ECDH_PARAMS, true, []);
}

// ---------------------------------------------------------------------
// ECDH shared secret -> AES-GCM "wrapping" key (used to protect the
// per-message key, one derivation per participant per message).
// ---------------------------------------------------------------------

async function deriveWrappingKey(myPrivateKey, peerPublicKeyJwk) {
  const peerPublicKey = await importPeerPublicKey(peerPublicKeyJwk);
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: peerPublicKey },
    myPrivateKey,
    AES_PARAMS,
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

// participants: [{ userId: string, publicKey: JWK }] — MUST include the
// sender themself, so they can decrypt their own sent messages later.
export async function encryptMessage(plaintext, participants) {
  const { privateKey } = await getOrCreateIdentityKeyPair();

  const messageKey = await crypto.subtle.generateKey(AES_PARAMS, true, [
    "encrypt",
    "decrypt",
  ]);

  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    messageKey,
    encoded,
  );

  const rawMessageKey = await crypto.subtle.exportKey("raw", messageKey);

  const keys = {};
  for (const participant of participants) {
    if (!participant.publicKey) {
      // Caller is expected to have already checked this — see
      // ensureAllParticipantsHaveKeys() below — but never silently drop
      // a recipient from the wrap set.
      throw new Error(
        `${participant.userId} has not set up encryption yet`,
      );
    }

    const wrappingKey = await deriveWrappingKey(privateKey, participant.publicKey);
    const wrapIv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
    const wrappedBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: wrapIv },
      wrappingKey,
      rawMessageKey,
    );

    keys[participant.userId] = {
      wrappedKey: bufToBase64(wrappedBuf),
      iv: bufToBase64(wrapIv),
    };
  }

  return {
    encrypted: true,
    ciphertext: bufToBase64(ciphertextBuf),
    iv: bufToBase64(iv),
    keys,
  };
}

// message: the raw message document from the server, containing
// { encrypted, ciphertext, iv, keys, sender: { _id, publicKey }, content }.
// myUserId: current user's id (their entry in `keys` is used).
// Returns plaintext, or a placeholder string if decryption isn't possible.
export async function decryptMessage(message, myUserId) {
  if (!message.encrypted) {
    // Legacy, pre-E2EE message — stored as plaintext, nothing to decrypt.
    return message.content || "";
  }

  const myKeyEntry = message.keys?.[myUserId];
  const senderPublicKey = message.sender?.publicKey;

  if (!myKeyEntry || !senderPublicKey) {
    return "[Message not available on this device]";
  }

  try {
    const { privateKey } = await getOrCreateIdentityKeyPair();
    const wrappingKey = await deriveWrappingKey(privateKey, senderPublicKey);

    const rawMessageKey = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBuf(myKeyEntry.iv) },
      wrappingKey,
      base64ToBuf(myKeyEntry.wrappedKey),
    );

    const messageKey = await crypto.subtle.importKey(
      "raw",
      rawMessageKey,
      AES_PARAMS,
      false,
      ["decrypt"],
    );

    const plaintextBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBuf(message.iv) },
      messageKey,
      base64ToBuf(message.ciphertext),
    );

    return new TextDecoder().decode(plaintextBuf);
  } catch (err) {
    console.error("Failed to decrypt message:", err);
    return "[Unable to decrypt message]";
  }
}

// Builds the participant list encryptMessage() expects from a populated
// conversation document (participants already include `publicKey` — see
// the server's conversation.service.js populate calls). Works identically
// for a 1-on-1 conversation (2 participants) and a group (N participants).
export function toEncryptionParticipants(conversation) {
  return (conversation?.participants || []).map((participant) => ({
    userId: String(participant._id || participant.id),
    name: participant.name,
    publicKey: participant.publicKey || null,
  }));
}

// Throws with a friendly message naming whoever hasn't set up E2EE yet,
// so the UI can block sending instead of silently leaving them out.
export function ensureAllParticipantsHaveKeys(participants) {
  const missing = participants.filter((p) => !p.publicKey);
  if (missing.length > 0) {
    const names = missing.map((p) => p.name || "A member").join(", ");
    throw new Error(`${names} hasn't set up encryption yet. Ask them to log in once.`);
  }
}
