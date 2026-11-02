const crypto = require("node:crypto");
const conversationService = require("../services/conversation.service");
const connectionManager = require("./connection.manager");

const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 96000;
const MAX_AUDIO_FRAME_BYTES = 32 * 1024;
const MAX_GROUP_CALL_MEMBERS = 8;
const CALL_TIMEOUT_MS = 30 * 1000;
const callTimeouts = new Map();
const AUDIO_HEADER_BYTES = 16;

function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendCallEnded(call, reason) {
  const memberIds =
    call.kind === "group"
      ? new Set([...call.participants.keys(), ...call.invitees.keys()])
      : new Set([call.callerId, call.receiverId]);
  for (const userId of memberIds) {
    connectionManager.sendToUser(userId, {
      type: "call:ended",
      data: { callId: call.callId, reason },
    });
  }
}

function validSampleRate(value) {
  return Number.isInteger(value) && value >= MIN_SAMPLE_RATE && value <= MAX_SAMPLE_RATE;
}

function groupCallMembers(call) {
  return connectionManager.listGroupCallMembers(call);
}

function broadcastGroupCall(call, type, data, excludedUserId = null) {
  const { participants, invitees } = groupCallMembers(call);
  for (const member of [...participants, ...invitees]) {
    if (member.id !== excludedUserId) {
      connectionManager.sendToUser(member.id, { type, data });
    }
  }
}

function broadcastJoinedGroupCall(call, type, data) {
  for (const participant of call.participants.values()) {
    connectionManager.sendToUser(participant.id, { type, data });
  }
}

function clearCallTimeout(callId) {
  const timeout = callTimeouts.get(callId);
  if (timeout) {
    clearTimeout(timeout);
    callTimeouts.delete(callId);
  }
}

async function handleStartCall(ws, callerId, { conversationId, data }) {
  const receiverId = String(data?.receiverId || "");
  const sampleRate = data?.sampleRate;

  if (
    !OBJECT_ID_REGEX.test(String(conversationId || "")) ||
    !validSampleRate(sampleRate)
  ) {
    return send(ws, {
      type: "call:error",
      data: { message: "Invalid call request" },
    });
  }

  try {
    const conversation = await conversationService.getConversationById(
      conversationId,
      callerId,
    );
    const caller = conversation.participants.find(
      (participant) => String(participant._id) === String(callerId),
    );
    if (!caller) {
      return send(ws, {
        type: "call:error",
        data: { message: "You are not a member of this conversation" },
      });
    }

    if (conversation.isGroup) {
      return handleStartGroupCall(ws, {
        callerId,
        caller,
        conversation,
        conversationId,
        sampleRate,
      });
    }

    if (
      !OBJECT_ID_REGEX.test(receiverId) ||
      receiverId === String(callerId)
    ) {
      return send(ws, {
        type: "call:error",
        data: { message: "Invalid call request" },
      });
    }

    const receiver = conversation.participants.find(
      (participant) => String(participant._id) === receiverId,
    );
    if (!caller || !receiver) {
      return send(ws, {
        type: "call:error",
        data: { message: "The call recipient is not in this conversation" },
      });
    }

    const receiverSocket = connectionManager.getConnection(receiverId);
    if (!receiverSocket || receiverSocket.readyState !== receiverSocket.OPEN) {
      return send(ws, {
        type: "call:error",
        data: { message: "This user is currently offline" },
      });
    }

    const callId = crypto.randomUUID();
    const call = connectionManager.startCall({
      callId,
      conversationId,
      callerId,
      receiverId,
      sampleRate,
    });
    if (!call) {
      return send(ws, {
        type: "call:error",
        data: { message: "One of you is already in a call" },
      });
    }

    connectionManager.sendToUser(receiverId, {
      type: "call:incoming",
      data: {
        callId,
        conversationId: String(conversationId),
        callerId: String(callerId),
        callerName: caller.name,
        sampleRate,
      },
    });
    send(ws, {
      type: "call:ringing",
      data: {
        callId,
        receiverId,
        receiverName: receiver.name,
      },
    });

    const timeout = setTimeout(() => {
      const ended = connectionManager.finishCall(callerId, callId);
      if (ended) sendCallEnded(ended.call, "no-answer");
      callTimeouts.delete(callId);
    }, CALL_TIMEOUT_MS);
    timeout.unref?.();
    callTimeouts.set(callId, timeout);
  } catch (error) {
    send(ws, {
      type: "call:error",
      data: {
        message: error.isOperational
          ? error.message
          : "Unable to start the call",
      },
    });
  }
}

function handleStartGroupCall(
  ws,
  { callerId, caller, conversation, conversationId, sampleRate },
) {
  const participants = conversation.participants || [];
  if (participants.length > MAX_GROUP_CALL_MEMBERS) {
    return send(ws, {
      type: "call:error",
      data: {
        message: `Group calls support up to ${MAX_GROUP_CALL_MEMBERS} members`,
      },
    });
  }

  const invitees = participants
    .filter((participant) => String(participant._id) !== String(callerId))
    .filter((participant) => {
      const participantId = String(participant._id);
      const socket = connectionManager.getConnection(participantId);
      return (
        socket &&
        socket.readyState === socket.OPEN &&
        !connectionManager.getCallForUser(participantId)
      );
    })
    .map((participant) => ({
      id: String(participant._id),
      name: participant.name || "User",
    }));

  if (invitees.length === 0) {
    return send(ws, {
      type: "call:error",
      data: { message: "No available group members to call" },
    });
  }

  const callId = crypto.randomUUID();
  const call = connectionManager.startGroupCall({
    callId,
    conversationId,
    conversationName: conversation.name || "Group call",
    callerId,
    callerName: caller.name || "User",
    sampleRate,
    invitees,
  });
  if (!call) {
    return send(ws, {
      type: "call:error",
      data: { message: "You are already in another call" },
    });
  }

  const members = groupCallMembers(call);
  for (const invitee of invitees) {
    connectionManager.sendToUser(invitee.id, {
      type: "call:incoming",
      data: {
        callId,
        conversationId: String(conversationId),
        callerId: String(callerId),
        callerName: caller.name || "User",
        isGroup: true,
        groupName: call.conversationName,
        sampleRate,
        participants: members.participants,
        invitees: members.invitees,
      },
    });
  }
  send(ws, {
    type: "call:ringing",
    data: {
      callId,
      receiverName: call.conversationName,
      isGroup: true,
      participants: members.participants,
      invitees: members.invitees,
    },
  });

  const timeout = setTimeout(() => {
    const expired = connectionManager.expireGroupInvites(callId);
    if (!expired) return;

    for (const invitee of expired.expiredInvitees) {
      connectionManager.sendToUser(invitee.id, {
        type: "call:ended",
        data: { callId, reason: "no-answer" },
      });
    }

    if (expired.ended) {
      sendCallEnded(expired.call, "no-answer");
    } else {
      broadcastGroupCall(expired.call, "call:participants", {
        callId,
        ...groupCallMembers(expired.call),
      });
    }
    callTimeouts.delete(callId);
  }, CALL_TIMEOUT_MS);
  timeout.unref?.();
  callTimeouts.set(callId, timeout);
}

function handleAcceptCall(ws, userId, data) {
  const { callId, sampleRate } = data || {};
  if (typeof callId !== "string" || !validSampleRate(sampleRate)) {
    return send(ws, {
      type: "call:error",
      data: { message: "Invalid call response" },
    });
  }

  const currentCall = connectionManager.getCallForUser(userId);
  if (currentCall?.callId === callId && currentCall.kind === "group") {
    const invitee = currentCall.invitees.get(String(userId));
    const call = connectionManager.acceptGroupCall(
      userId,
      callId,
      sampleRate,
      invitee?.name,
    );
    if (!call) {
      return send(ws, {
        type: "call:error",
        data: { message: "This group call is no longer available" },
      });
    }

    const members = groupCallMembers(call);
    const joinedEvent = {
      callId,
      isGroup: true,
      participant: call.participants.get(String(userId)),
      ...members,
    };
    broadcastJoinedGroupCall(call, "call:accepted", joinedEvent);
    broadcastGroupCall(
      call,
      "call:participant-joined",
      joinedEvent,
      String(userId),
    );
    return;
  }

  const call = connectionManager.acceptCall(userId, callId, sampleRate);
  if (!call) {
    return send(ws, {
      type: "call:error",
      data: { message: "This call is no longer available" },
    });
  }

  clearCallTimeout(callId);
  connectionManager.sendToUser(call.callerId, {
    type: "call:accepted",
    data: {
      callId,
      peerId: call.receiverId,
      sampleRate: call.receiverSampleRate,
    },
  });
  send(ws, {
    type: "call:accepted",
    data: {
      callId,
      peerId: call.callerId,
      sampleRate: call.callerSampleRate,
    },
  });
}

function handleEndCall(ws, userId, data, reason) {
  const { callId } = data || {};
  if (typeof callId !== "string") {
    return send(ws, {
      type: "call:error",
      data: { message: "A valid callId is required" },
    });
  }

  const call = connectionManager.getCallForUser(userId);
  if (call?.callId === callId && call.kind === "group") {
    const result = connectionManager.leaveGroupCall(userId, callId, reason);
    if (!result) {
      return send(ws, {
        type: "call:error",
        data: { message: "This call is no longer active" },
      });
    }

    if (result.ended) {
      clearCallTimeout(callId);
      sendCallEnded(result.call, result.reason);
    } else {
      broadcastGroupCall(
        result.call,
        "call:participant-left",
        {
          callId,
          participantId: result.participant.id,
          reason: result.reason,
          ...groupCallMembers(result.call),
        },
        result.participant.id,
      );
    }
    return;
  }

  const ended = connectionManager.finishCall(userId, callId);
  if (!ended) {
    return send(ws, {
      type: "call:error",
      data: { message: "This call is no longer active" },
    });
  }

  clearCallTimeout(callId);
  sendCallEnded(ended.call, reason);
}

function handleAudioFrame(ws, senderId, frame) {
  const peer = connectionManager.getActiveCallPeer(senderId);
  if (
    !peer ||
    frame.length < AUDIO_HEADER_BYTES + 4 ||
    frame.length > MAX_AUDIO_FRAME_BYTES ||
    (frame.length - AUDIO_HEADER_BYTES) % 4 !== 0
  ) {
    return;
  }

  const speakerId = frame.subarray(4, AUDIO_HEADER_BYTES).toString("hex");
  const sampleRate = frame.readUInt32LE(0);
  if (speakerId !== String(senderId).toLowerCase()) {
    return;
  }
  if (!validSampleRate(sampleRate)) {
    return;
  }

  const peerIds = peer.peerIds || [peer.peerId];
  for (const peerId of peerIds) {
    const receiver = connectionManager.getConnection(peerId);
    if (!receiver || receiver.readyState !== receiver.OPEN) {
      continue;
    }
    if (receiver.bufferedAmount > 128 * 1024) continue;
    receiver.send(frame, { binary: true });
  }
}

function handleCallEvent(ws, userId, { type, conversationId, data }) {
  switch (type) {
    case "call:start":
      return handleStartCall(ws, userId, { conversationId, data });
    case "call:accept":
      return handleAcceptCall(ws, userId, data);
    case "call:reject": {
      const call = connectionManager.getCallForUser(userId);
      if (call?.callId === data?.callId && call.kind === "group") {
        const declined = connectionManager.declineGroupCall(userId, data.callId);
        if (!declined) {
          return send(ws, {
            type: "call:error",
            data: { message: "This group call is no longer available" },
          });
        }

        broadcastGroupCall(
          declined.call,
          "call:participant-declined",
          {
            callId: data.callId,
            participantId: declined.participant.id,
            ...groupCallMembers(declined.call),
          },
        );
        if (
          declined.call.participants.size === 1 &&
          declined.call.invitees.size === 0
        ) {
          const ended = connectionManager.leaveGroupCall(
            declined.call.callerId,
            data.callId,
            "declined",
          );
          if (ended) sendCallEnded(ended.call, "declined");
        }
        return;
      }
      return handleEndCall(ws, userId, data, "declined");
    }
    case "call:end":
      return handleEndCall(ws, userId, data, "ended");
    default:
      return send(ws, {
        type: "call:error",
        data: { message: "Unknown call event" },
      });
  }
}

module.exports = { handleCallEvent, handleAudioFrame };
