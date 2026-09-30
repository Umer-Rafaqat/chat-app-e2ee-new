const User = require("../models/User");
const conversationService = require("../services/conversation.service");
const broadcast = require("./broadcast");
const { ROLES } = require("../config/roles");
const {
  createGroupSchema,
  updateGroupSchema,
} = require("../validators/conversation.validator");

const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

function sendError(ws, event, status, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(
      JSON.stringify({ type: "error", data: { event, status, message } }),
    );
  }
}

function validated(schema, data) {
  const { error, value } = schema.validate(data ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const message = error.details.map((d) => d.message).join(", ");
    const err = new Error(message);
    err.status = 400;
    throw err;
  }

  return value;
}

function requireGroupId(conversationId) {
  if (!OBJECT_ID_REGEX.test(String(conversationId))) {
    const err = new Error("A valid conversationId is required");
    err.status = 400;
    throw err;
  }
  return String(conversationId);
}

const ACTIONS = {
  "group:create": async ({ actorId, data }) => {
    const { name, participantIds } = validated(createGroupSchema, data);
    const group = await conversationService.createGroupConversation(
      actorId,
      name,
      participantIds,
    );
    await broadcast.groupCreated(group);
  },

  "group:update": async ({ conversationId, data }) => {
    const { name } = validated(updateGroupSchema, data);
    const group = await conversationService.renameGroup(
      requireGroupId(conversationId),
      name,
    );
    await broadcast.groupUpdated(group);
  },

  "group:delete": async ({ conversationId }) => {
    const result = await conversationService.deleteGroup(
      requireGroupId(conversationId),
    );
    await broadcast.groupDeleted(result);
  },
};

// Admin-only group events. The role is NEVER read from the payload or from
// state captured at connect time: it is re-read from the database on every
// event, so a demoted/disabled admin loses access immediately.
async function handleGroupEvent(ws, userId, { type, conversationId, data }) {
  const action = ACTIONS[type];

  if (!action) {
    return sendError(ws, type, 400, `Unknown event type: ${type}`);
  }

  try {
    const actor = await User.findById(userId).select("role accountDisabled");

    if (!actor || actor.accountDisabled) {
      sendError(ws, type, 401, "Not authenticated");
      return ws.close(4001, "Not authenticated");
    }

    if (actor.role !== ROLES.ADMIN) {
      return sendError(ws, type, 403, "Admin access required");
    }

    await action({ actorId: userId, conversationId, data });
  } catch (err) {
    sendError(
      ws,
      type,
      err.status || err.statusCode || 500,
      err.isOperational || err.status ? err.message : "Group operation failed",
    );
  }
}

module.exports = handleGroupEvent;
