const Message = require("../models/Message");
const AppError = require("../utils/AppError");

const conversationService = require("./conversation.service");

const notificationService = require("./notification.service");

const pushService = require("./push.service");

const connectionManager = require("../websocket/connection.manager");

async function createMessage({
  conversationId,

  senderId,

  // Encrypted text message (every new text message uses this path — the
  // server stores ciphertext only and never sees the plaintext).
  encrypted = false,
  ciphertext = null,
  iv = null,
  keys = null,

  imageUrl = null,
}) {
  const conversation = await conversationService.getConversationById(
    conversationId,

    senderId,
  );

  if (encrypted) {
    // Defense in depth: the client picks recipients, but the server still
    // checks every CURRENT participant got a wrapped copy of the key —
    // it can't verify the crypto is correct, only that nobody was skipped.
    const participantIds = conversation.participants.map((p) => p._id.toString());
    const coveredIds = new Set(Object.keys(keys || {}));
    const missing = participantIds.filter((id) => !coveredIds.has(id));

    if (missing.length > 0) {
      throw new AppError(
        "Message is not encrypted for every current participant",
        400,
      );
    }
  }

  const message = await Message.create({
    conversation: conversationId,

    sender: senderId,

    encrypted,
    ciphertext,
    iv,
    keys,

    imageUrl,

    messageType: imageUrl ? "image" : "text",
  });

  await message.populate("sender", "name email publicKey");

  const participantIds = conversation.participants.map((participant) =>
    participant._id ? participant._id.toString() : participant.toString(),
  );

  const senderIdString = senderId.toString();

  /*
   * Everyone except sender.
   */
  const recipientIds = participantIds.filter(
    (participantId) => participantId !== senderIdString,
  );

  /*
   * Only users who are NOT currently
   * viewing this exact conversation
   * should receive notifications.
   */
  const notificationRecipientIds = recipientIds.filter(
    (recipientId) =>
      !connectionManager.isConversationActive(
        recipientId,

        conversationId,
      ),
  );

  // The server cannot read encrypted content, so the notification/push
  // preview is always generic for text messages — never a guess, never a
  // leak. Only the (unencrypted) image case gets a specific label.
  const notificationContent = imageUrl ? "Sent an image" : "New message";

  /*
   * Save persistent in-app notifications.
   */
  const notifications = await notificationService.createNotifications({
    recipientIds: notificationRecipientIds,

    conversationId,

    messageId: message._id,

    senderId,

    content: notificationContent,
  });

  /*
   * Send Firebase push notifications
   * to the same recipients.
   *
   * Push failure must not break the
   * message creation flow.
   */
  if (notificationRecipientIds.length > 0) {
    try {
      await pushService.sendPushNotifications(
        notificationRecipientIds,

        {
          type: "chat-message",

          title: message.sender?.name
            ? `${message.sender.name} sent you a message`
            : "New message",

          body: notificationContent,

          icon: "/notification-icon.png",

          badge: "/notification-icon.png",

          data: {
            conversationId: String(conversationId),

            messageId: String(message._id),

            senderId: String(senderId),

            senderName: message.sender?.name || "Unknown user",
          },
        },
      );
    } catch (error) {
      /*
       * Push notification failure should
       * never make the chat message fail.
       */
      console.error("Firebase push notification failed:", error);
    }
  }

  return {
    message,

    participantIds,

    notifications,
  };
}

async function getMessagesForConversation(conversationId, userId) {
  await conversationService.getConversationById(
    conversationId,

    userId,
  );

  return Message.find({
    conversation: conversationId,
  })
    .populate("sender", "name email publicKey")
    .sort({
      createdAt: 1,
    });
}

module.exports = {
  createMessage,

  getMessagesForConversation,
};
