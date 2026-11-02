const connections = new Map();
const calls = new Map();
const userCallIds = new Map();

function notifyGroupCallChange(result) {
  if (!result) return;

  if (result.ended) {
    const memberIds = new Set([
      ...result.call.participants.keys(),
      ...result.call.invitees.keys(),
    ]);
    memberIds.forEach((memberId) =>
      sendToUser(memberId, {
        type: "call:ended",
        data: { callId: result.call.callId, reason: result.reason },
      }),
    );
    return;
  }

  const memberIds = new Set([
    ...result.call.participants.keys(),
    ...result.call.invitees.keys(),
  ]);
  memberIds.forEach((memberId) =>
    sendToUser(memberId, {
      type: "call:participant-left",
      data: {
        callId: result.call.callId,
        participantId: result.participant.id,
      },
    }),
  );
}

function addConnection(userId, ws) {
  const existing = connections.get(userId);

  if (existing?.ws && existing.ws.readyState === existing.ws.OPEN) {
    const call = getCallForUser(userId);
    if (call?.kind === "group") {
      notifyGroupCallChange(
        leaveGroupCall(userId, call.callId, "peer-disconnected"),
      );
    } else if (call) {
      const endedCall = finishCall(userId, call.callId);
      if (endedCall) {
        sendToUser(endedCall.peerId, {
          type: "call:ended",
          data: { callId: endedCall.call.callId, reason: "peer-disconnected" },
        });
      }
    }
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
    const call = getCallForUser(userId);
    if (call?.kind === "group") {
      notifyGroupCallChange(
        leaveGroupCall(userId, call.callId, "peer-disconnected"),
      );
    } else if (call) {
      const endedCall = finishCall(userId, call.callId);
      if (endedCall) {
        sendToUser(endedCall.peerId, {
          type: "call:ended",
          data: { callId: endedCall.call.callId, reason: "peer-disconnected" },
        });
      }
    }
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

function startCall({
  callId,
  conversationId,
  callerId,
  receiverId,
  sampleRate,
}) {
  const caller = String(callerId);
  const receiver = String(receiverId);
  if (userCallIds.has(caller) || userCallIds.has(receiver)) {
    return false;
  }

  const call = {
    kind: "direct",
    callId,
    conversationId: String(conversationId),
    callerId: caller,
    receiverId: receiver,
    callerSampleRate: sampleRate,
    receiverSampleRate: null,
    status: "ringing",
  };

  calls.set(callId, call);
  userCallIds.set(call.callerId, callId);
  userCallIds.set(call.receiverId, callId);
  return call;
}

function getCallForUser(userId) {
  const callId = userCallIds.get(String(userId));
  return callId ? calls.get(callId) : null;
}

function startGroupCall({
  callId,
  conversationId,
  conversationName,
  callerId,
  callerName,
  sampleRate,
  invitees,
}) {
  const caller = String(callerId);
  if (userCallIds.has(caller) || invitees.some(({ id }) => userCallIds.has(String(id)))) {
    return false;
  }

  const call = {
    kind: "group",
    callId,
    conversationId: String(conversationId),
    conversationName,
    callerId: caller,
    status: "ringing",
    participants: new Map([
      [caller, { id: caller, name: callerName, sampleRate }],
    ]),
    invitees: new Map(
      invitees.map(({ id, name }) => [
        String(id),
        { id: String(id), name },
      ]),
    ),
  };

  calls.set(callId, call);
  userCallIds.set(caller, callId);
  call.invitees.forEach((invitee) => userCallIds.set(invitee.id, callId));
  return call;
}

function acceptGroupCall(userId, callId, sampleRate, name) {
  const id = String(userId);
  const call = calls.get(callId);
  const invitee = call?.invitees.get(id);
  if (!call || call.kind !== "group" || !invitee) {
    return null;
  }

  call.invitees.delete(id);
  call.participants.set(id, { ...invitee, sampleRate });
  call.status = "active";
  return call;
}

function declineGroupCall(userId, callId) {
  const id = String(userId);
  const call = calls.get(callId);
  if (!call || call.kind !== "group" || !call.invitees.has(id)) {
    return null;
  }

  const invitee = call.invitees.get(id);
  call.invitees.delete(id);
  userCallIds.delete(id);
  return { call, participant: invitee };
}

function leaveGroupCall(userId, callId, reason = "left") {
  const id = String(userId);
  const call = calls.get(callId);
  if (!call || call.kind !== "group") {
    return null;
  }

  const participant = call.participants.get(id) || call.invitees.get(id);
  if (!participant) {
    return null;
  }

  if (call.callerId === id) {
    calls.delete(callId);
    for (const memberId of [
      ...call.participants.keys(),
      ...call.invitees.keys(),
    ]) {
      userCallIds.delete(memberId);
    }
    return { call, participant, ended: true, reason };
  }

  call.participants.delete(id);
  call.invitees.delete(id);
  userCallIds.delete(id);

  if (call.participants.size === 1 && call.invitees.size === 0) {
    calls.delete(callId);
    for (const memberId of call.participants.keys()) {
      userCallIds.delete(memberId);
    }
    return { call, participant, ended: true, reason: "last-participant-left" };
  }

  return { call, participant, ended: false, reason };
}

function expireGroupInvites(callId) {
  const call = calls.get(callId);
  if (!call || call.kind !== "group") {
    return null;
  }

  const expiredInvitees = [...call.invitees.values()];
  for (const invitee of expiredInvitees) {
    userCallIds.delete(invitee.id);
  }
  call.invitees.clear();

  if (call.participants.size <= 1) {
    calls.delete(callId);
    for (const participantId of call.participants.keys()) {
      userCallIds.delete(participantId);
    }
    return { call, expiredInvitees, ended: true };
  }

  return { call, expiredInvitees, ended: false };
}

function listGroupCallMembers(call) {
  return {
    participants: [...call.participants.values()],
    invitees: [...call.invitees.values()],
  };
}

function acceptCall(userId, callId, sampleRate) {
  const call = calls.get(callId);
  if (
    !call ||
    call.receiverId !== String(userId) ||
    call.status !== "ringing"
  ) {
    return null;
  }

  call.receiverSampleRate = sampleRate;
  call.status = "active";
  return call;
}

function finishCall(userId, callId) {
  const call = calls.get(callId);
  if (
    !call ||
    (call.callerId !== String(userId) && call.receiverId !== String(userId))
  ) {
    return null;
  }

  calls.delete(callId);
  userCallIds.delete(call.callerId);
  userCallIds.delete(call.receiverId);

  return {
    call,
    peerId: call.callerId === String(userId) ? call.receiverId : call.callerId,
  };
}

function getActiveCallPeer(userId) {
  const call = getCallForUser(userId);
  if (call?.kind === "group") {
    if (call.status !== "active" || !call.participants.has(String(userId))) {
      return null;
    }
    return {
      call,
      peerIds: [...call.participants.keys()].filter(
        (participantId) => participantId !== String(userId),
      ),
    };
  }
  if (!call || call.status !== "active") {
    return null;
  }

  return {
    call,
    peerId: call.callerId === String(userId) ? call.receiverId : call.callerId,
    sampleRate:
      call.callerId === String(userId)
        ? call.receiverSampleRate
        : call.callerSampleRate,
  };
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
  startCall,
  startGroupCall,
  getCallForUser,
  acceptCall,
  acceptGroupCall,
  declineGroupCall,
  leaveGroupCall,
  expireGroupInvites,
  listGroupCallMembers,
  finishCall,
  getActiveCallPeer,
  onlineCount,
};
