const Joi = require("joi");

const createConversationSchema = Joi.object({
  participantId: Joi.string().hex().length(24).required(),
});

const objectId = Joi.string().hex().length(24);

const createGroupSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  participantIds: Joi.array().items(objectId).unique().min(1).max(500).required(),
});

const updateGroupSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
});

module.exports = {
  createConversationSchema,
  createGroupSchema,
  updateGroupSchema,
};
