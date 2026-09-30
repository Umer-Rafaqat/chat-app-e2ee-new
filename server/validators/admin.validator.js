const Joi = require("joi");
const { ROLE_VALUES } = require("../config/roles");

const listUsersQuerySchema = Joi.object({
  search: Joi.string().trim().max(100).allow(""),
  role: Joi.string().valid(...ROLE_VALUES),
  status: Joi.string().valid("active", "disabled"),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const updateUserStatusSchema = Joi.object({
  accountDisabled: Joi.boolean().required(),
});

const updateUserRoleSchema = Joi.object({
  role: Joi.string()
    .valid(...ROLE_VALUES)
    .required(),
});

module.exports = {
  listUsersQuerySchema,
  updateUserStatusSchema,
  updateUserRoleSchema,
};
