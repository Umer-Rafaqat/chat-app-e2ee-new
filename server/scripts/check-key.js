require("dotenv/config");
const crypto = require("node:crypto");

const key = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
console.log(
  "starts with BEGIN:",
  key.startsWith("-----BEGIN PRIVATE KEY-----"),
);
console.log("ends with END:", key.trim().endsWith("-----END PRIVATE KEY-----"));
console.log("has line breaks:", key.includes("\n"));
crypto.createPrivateKey(key);
console.log("key parses OK");
