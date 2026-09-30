const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Legacy plaintext field. Only ever populated on rows written before
    // E2EE existed — no new message writes this. Kept so old chat history
    // still renders instead of breaking.
    content: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    // True for every message sent through the E2EE path (i.e. every new
    // text message). The server cannot read `ciphertext` — it has no key.
    encrypted: {
      type: Boolean,
      default: false,
    },

    // Base64 AES-256-GCM ciphertext of the message text.
    ciphertext: {
      type: String,
      default: null,
    },

    // Base64 IV used for `ciphertext`.
    iv: {
      type: String,
      default: null,
    },

    // One entry per recipient who could read this message at send time
    // (every participant, sender included): their copy of the random
    // per-message AES key, wrapped with a key only they and the sender
    // can derive (ECDH). Not a group key — nothing to rotate.
    //   userId -> { wrappedKey: base64, iv: base64 }
    keys: {
      type: Map,
      of: new mongoose.Schema(
        {
          wrappedKey: { type: String, required: true },
          iv: { type: String, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },

    imageUrl: {
      type: String,
      default: null,
    },
    messageType: {
      type: String,
      enum: ["text", "image"],
      default: "text",
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.pre("validate", function enforceOneContentForm() {
  const hasLegacyContent = Boolean(this.content?.trim());
  const hasEncryptedContent = Boolean(
    this.encrypted && this.ciphertext && this.iv && this.keys?.size,
  );
  const hasImage = Boolean(this.imageUrl);

  if (!hasLegacyContent && !hasEncryptedContent && !hasImage) {
    throw new Error("Message content or image is required");
  }
});

module.exports = mongoose.model("Message", messageSchema);
