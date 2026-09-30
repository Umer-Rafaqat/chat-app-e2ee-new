const Joi = require("joi");

// A JWK (JSON Web Key) for an ECDH P-256 public key, as produced by the
// browser's SubtleCrypto.exportKey("jwk", ...). We only check the shape —
// the server never uses this key cryptographically, it just stores and
// relays it, so it cannot validate that the point is actually on the curve.
const publicKeySchema = Joi.object({
  publicKey: Joi.object({
    kty: Joi.string().valid("EC").required(),
    crv: Joi.string().valid("P-256").required(),
    x: Joi.string().trim().min(1).max(100).required(),
    y: Joi.string().trim().min(1).max(100).required(),
    ext: Joi.boolean().optional(),
    key_ops: Joi.array().items(Joi.string()).optional(),
  })
    .unknown(false)
    .required(),
});

module.exports = { publicKeySchema };
