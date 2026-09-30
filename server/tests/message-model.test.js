/*
 * Message schema validation — runs Mongoose's REAL validate() (no DB
 * connection needed for this, no fake). rbac.test.js and e2ee.test.js both
 * replace Message.create with an in-memory fake, so they never exercise
 * this validation logic; this file is what actually catches a broken
 * schema/hook before it reaches a real database.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Message = require("../models/Message");

const newMessage = (overrides) =>
  new Message({
    conversation: new mongoose.Types.ObjectId(),
    sender: new mongoose.Types.ObjectId(),
    ...overrides,
  });

test("rejects a message with no content, no ciphertext, and no image", async () => {
  await assert.rejects(newMessage({}).validate());
});

test("accepts a legacy plaintext message (pre-E2EE history)", async () => {
  await newMessage({ content: "hi" }).validate();
});

test("accepts a fully-formed encrypted message", async () => {
  await newMessage({
    encrypted: true,
    ciphertext: "c",
    iv: "i",
    keys: { someUserId: { wrappedKey: "w", iv: "i" } },
  }).validate();
});

test("rejects encrypted:true with an empty keys map (nobody could ever read it)", async () => {
  await assert.rejects(
    newMessage({ encrypted: true, ciphertext: "c", iv: "i", keys: {} }).validate(),
  );
});

test("rejects encrypted:true missing ciphertext or iv", async () => {
  await assert.rejects(
    newMessage({ encrypted: true, iv: "i", keys: { a: { wrappedKey: "w", iv: "i" } } }).validate(),
  );
  await assert.rejects(
    newMessage({ encrypted: true, ciphertext: "c", keys: { a: { wrappedKey: "w", iv: "i" } } }).validate(),
  );
});

test("accepts an image-only message", async () => {
  await newMessage({ imageUrl: "https://example.com/photo.png" }).validate();
});

test("a keys entry always needs both wrappedKey and iv", async () => {
  await assert.rejects(
    newMessage({
      encrypted: true,
      ciphertext: "c",
      iv: "i",
      keys: { a: { wrappedKey: "w" } }, // missing iv
    }).validate(),
  );
});
