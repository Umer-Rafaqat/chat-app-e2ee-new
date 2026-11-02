const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
} = require("./env");

function normalizePrivateKey(raw = "") {
  const body = raw
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

const firebaseApp = initializeApp({
  credential: cert({
    projectId: FIREBASE_PROJECT_ID,

    clientEmail: FIREBASE_CLIENT_EMAIL,

    privateKey: normalizePrivateKey(FIREBASE_PRIVATE_KEY),
  }),
});

const firebaseMessaging = getMessaging(firebaseApp);

module.exports = {
  firebaseApp,
  firebaseMessaging,
  normalizePrivateKey,
};
