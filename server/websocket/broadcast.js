const User = require("../models/User");
const { ROLES } = require("../config/roles");
const connectionManager = require("./connection.manager");

const idOf = (value) => String(value?._id || value);

// Group members + every admin (so open admin panels stay in sync too).
async function getAudience(participantIds) {
  const admins = await User.find({
    role: ROLES.ADMIN,
    accountDisabled: false,
  }).distinct("_id");

  return new Set([...participantIds.map(idOf), ...admins.map(idOf)]);
}

async function deliver(payload, participantIds) {
  try {
    const audience = await getAudience(participantIds);
    audience.forEach((userId) => connectionManager.sendToUser(userId, payload));
  } catch (err) {
    // A failed broadcast must never fail the (already committed) request.
    console.error("Group broadcast failed:", err.message);
  }
}

const participantIdsOf = (group) => group.participants.map(idOf);

async function groupCreated(group) {
  await deliver({ type: "group:created", data: group }, participantIdsOf(group));
}

async function groupUpdated(group) {
  await deliver({ type: "group:updated", data: group }, participantIdsOf(group));
}

async function groupDeleted({ conversationId, participantIds }) {
  // Anyone who had the deleted group open must stop being "active" in it.
  participantIds.forEach((userId) =>
    connectionManager.clearActiveConversation(userId, conversationId),
  );

  await deliver(
    { type: "group:deleted", data: { conversationId } },
    participantIds,
  );
}

module.exports = { groupCreated, groupUpdated, groupDeleted };
