const messageService = require("../services/message.service");
const conversationService = require("../services/conversation.service");
const connectionManager = require("./connection.manager");
const handleGroupEvent = require("./group.handler");
const { handleCallEvent, handleAudioFrame } = require("./call.handler");
const { CLOUDINARY_CLOUD_NAME } = require("../config/env");

function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function handleMessage(ws, senderId, raw, isBinary = false) {
  if (isBinary) {
    return handleAudioFrame(ws, senderId, raw);
  }

  let parsed;

  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return send(ws, {
      type: "error",
      data: {
        message: "Invalid JSON",
      },
    });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return send(ws, {
      type: "error",
      data: { message: "Message payload must be an object" },
    });
  }

  const { type, conversationId, data = {} } = parsed;

  if (typeof type === "string" && type.startsWith("call:")) {
    return handleCallEvent(ws, senderId, { type, conversationId, data });
  }

  /*
   * Admin-only group management (group:create | group:update | group:delete).
   * Authorization is enforced inside the handler from the database.
   */
  if (typeof type === "string" && type.startsWith("group:")) {
    return handleGroupEvent(ws, senderId, { type, conversationId, data });
  }

  /*
   * User opened a conversation.
   *
   * Tell the server:
   * "This is the conversation I am currently viewing."
   */
  if (type === "conversation:open") {
    if (!conversationId) {
      return send(ws, {
        type: "error",
        data: {
          message: "conversationId is required",
        },
      });
    }

    try {
      /*
       * This also verifies that the current user
       * actually belongs to this conversation.
       */
      await conversationService.getConversationById(conversationId, senderId);

      connectionManager.setActiveConversation(senderId, conversationId);

      return;
    } catch (err) {
      return send(ws, {
        type: "error",
        data: {
          message: err.message || "Unable to open conversation",
        },
      });
    }
  }

  /*
   * User closed the currently active conversation.
   */
  if (type === "conversation:close") {
    connectionManager.clearActiveConversation(senderId, conversationId);

    return;
  }

  /*
   * Only these events are allowed below.
   */
  if (type !== "message" && type !== "image") {
    return send(ws, {
      type: "error",
      data: {
        message: `Unknown event type: ${type}`,
      },
    });
  }

  if (!conversationId) {
    return send(ws, {
      type: "error",
      data: { message: "conversationId is required" },
    });
  }

  // `data` sent by the client for each event type:
  //   image   -> { imageUrl }                          (unencrypted — see note below)
  //   message -> { ciphertext, iv, keys }               (E2EE — server never sees plaintext)
  let payload;

  if (type === "image") {
    // Images are NOT end-to-end encrypted yet — only text messages are.
    // Uploaded via the existing REST /upload endpoint before this event.
    if (
      typeof data?.imageUrl !== "string" ||
      !data.imageUrl.startsWith(
        `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/`,
      )
    ) {
      return send(ws, {
        type: "error",
        data: { message: "A valid Cloudinary image URL is required" },
      });
    }
    payload = { imageUrl: data.imageUrl };
  } else {
    // type === "message": every text message must already be encrypted
    // client-side. The server has no decryption key and cannot fall back
    // to reading plaintext.
    const { ciphertext, iv, keys } = data || {};

    if (
      !ciphertext ||
      !iv ||
      !keys ||
      typeof keys !== "object" ||
      Object.keys(keys).length === 0
    ) {
      return send(ws, {
        type: "error",
        data: {
          message: "Message must be encrypted (ciphertext, iv and keys are required)",
        },
      });
    }

    // Base64 ciphertext of a 2000-char message is comfortably under this;
    // this just stops abusively large payloads, not legitimate ones.
    if (ciphertext.length > 8000) {
      return send(ws, {
        type: "error",
        data: { message: "Message too long" },
      });
    }

    if (Object.keys(keys).length > 500) {
      return send(ws, {
        type: "error",
        data: { message: "Too many recipients" },
      });
    }

    payload = { encrypted: true, ciphertext, iv, keys };
  }

  try {
    const { message, participantIds, notifications } =
      await messageService.createMessage({
        conversationId,
        senderId,
        ...payload,
      });

    /*
     * Send message to every participant.
     */
    const outgoingMessage = {
      type: "message",
      conversationId,
      data: message,
    };

    participantIds.forEach((participantId) => {
      send(connectionManager.getConnection(participantId), outgoingMessage);
    });

    /*
     * Send notifications only to users
     * for whom a notification was actually created.
     */
    notifications.forEach((notification) => {
      const recipientId = notification.recipient.toString();

      send(connectionManager.getConnection(recipientId), {
        type: "notification",

        data: {
          id: notification._id,

          conversationId: notification.conversation.toString(),

          messageId: notification.message.toString(),

          sender: message.sender,

          content: notification.content,

          createdAt: notification.createdAt,
        },
      });
    });
  } catch (err) {
    send(ws, {
      type: "error",
      data: {
        message: err.message || "Failed to send message",
      },
    });
  }
}

module.exports = handleMessage;
