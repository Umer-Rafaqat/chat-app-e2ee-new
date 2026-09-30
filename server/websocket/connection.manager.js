// Tracks exactly one active WebSocket connection per authenticated user.
// userId (string) -> { ws, activeConversationId }

const connections = new Map();

function addConnection(userId, ws) {
  const existing = connections.get(userId);

  if (existing?.ws && existing.ws.readyState === existing.ws.OPEN) {
    existing.ws.close(1000, "Replaced by new connection");
  }

  connections.set(userId, {
    ws,
    activeConversationId: null,
  });
}

function removeConnection(userId, ws) {
  const current = connections.get(userId);

  // Only remove the current connection.
  // This prevents an old socket's close event from deleting
  // a newer connection for the same user.
  if (current?.ws === ws) {
    connections.delete(userId);
  }
}

function getConnection(userId) {
  return connections.get(userId)?.ws;
}

function setActiveConversation(userId, conversationId) {
  const current = connections.get(userId);

  if (!current) {
    return false;
  }

  current.activeConversationId = conversationId
    ? conversationId.toString()
    : null;

  return true;
}

function clearActiveConversation(userId, conversationId) {
  const current = connections.get(userId);

  if (!current) {
    return false;
  }

  // Only clear if the client is closing the conversation
  // that is currently marked active.
  if (
    !conversationId ||
    current.activeConversationId === conversationId.toString()
  ) {
    current.activeConversationId = null;
  }

  return true;
}

function isConversationActive(userId, conversationId) {
  const current = connections.get(userId);

  if (!current || !conversationId) {
    return false;
  }

  return current.activeConversationId === conversationId.toString();
}

function sendToUser(userId, payload) {
  const ws = getConnection(userId);

  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
    return true;
  }

  return false;
}

// Force-close a user's socket (account disabled, etc.).
function disconnectUser(userId, code = 4003, reason = "Access revoked") {
  const ws = getConnection(userId);

  if (ws && ws.readyState === ws.OPEN) {
    ws.close(code, reason);
  }
}

function onlineCount() {
  return connections.size;
}

module.exports = {
  addConnection,
  removeConnection,
  getConnection,
  setActiveConversation,
  clearActiveConversation,
  isConversationActive,
  sendToUser,
  disconnectUser,
  onlineCount,
};
