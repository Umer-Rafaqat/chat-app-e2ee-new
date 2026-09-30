const mongoose = require("mongoose");
const { ROLES, ROLE_VALUES } = require("../config/roles");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    loginFailedAttempts: {
      type: Number,
      default: 0,
    },

    loginLockLevel: {
      type: Number,
      default: 0,
    },

    // Temporary lock expiration time.
    loginLockedUntil: {
      type: Date,
      default: null,
    },

    // Permanent account disable.
    accountDisabled: {
      type: Boolean,
      default: false,
    },

    // Authorization role. The database is the only source of truth:
    // it is never read from a request body or from the JWT payload.
    role: {
      type: String,
      enum: ROLE_VALUES,
      default: ROLES.USER,
      index: true,
    },

    verificationRequired: {
      type: Boolean,
      default: false,
    },

    /*
     * E2EE identity public key (ECDH, P-256), as a JWK.
     * The matching private key NEVER leaves the user's browser — the
     * server only ever stores/relays this public half.
     */
    publicKey: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
