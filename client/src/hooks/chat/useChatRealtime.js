import { useCallback, useEffect } from "react";
import useWebSocket from "../useWebSocket";
import { decryptMessage } from "../../lib/e2ee";

function getId(value) {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || "");
  return String(value);
}

function normalizeNotification(notification) {
  return {
    id: String(notification._id || notification.id || ""),
    conversationId: String(
      notification.conversation?._id || notification.conversationId || "",
    ),
    messageId: String(
      notification.message?._id || notification.messageId || "",
    ),
    senderName:
      notification.sender?.name || notification.senderName || "Unknown user",
    content:
      notification.content || notification.message?.content || "New message",
    createdAt:
      notification.createdAt || notification.message?.createdAt || null,
  };
}

export { normalizeNotification };

export default function useChatRealtime({
  user,
  activeConversation,
  setMessages,
  setNotifications,
  setConversations,
  setActiveConversation,
}) {
  const handleWsEvent = useCallback(
    (event) => {
      if (event.type === "message") {
        const incomingConversationId = String(event.conversationId);
        const incomingMessage = event.data;
        const currentUserId = getId(user);
        const senderId = getId(incomingMessage.sender);
        const isOwnMessage = senderId === currentUserId;
        const isActiveConversation =
          incomingConversationId === String(activeConversation?._id || "");

        if (isActiveConversation) {
          // Decryption is async (Web Crypto); the message is appended once
          // it resolves, using a functional update so it's safe no matter
          // what else has changed state in the meantime.
          decryptMessage(incomingMessage, currentUserId).then((content) => {
            const decrypted = { ...incomingMessage, content };
            setMessages((prev) =>
              prev.some(
                (message) => String(message._id) === String(decrypted._id),
              )
                ? prev
                : [...prev, decrypted],
            );
          });
        }

        if (isOwnMessage || isActiveConversation) return;
      }

      if (event.type === "notification") {
        const notification = normalizeNotification(event.data);
        setNotifications((prev) =>
          prev.some((item) => String(item.id) === String(notification.id))
            ? prev
            : [notification, ...prev],
        );
      }

      /*
       * Admin group changes, broadcast by the server after it has
       * verified the admin's role and written to the database.
       */
      if (event.type === "group:created") {
        const group = event.data;
        setConversations((prev) =>
          prev.some((item) => String(item._id) === String(group._id))
            ? prev
            : [group, ...prev],
        );
      }

      if (event.type === "group:updated") {
        const group = event.data;
        setConversations((prev) =>
          prev.map((item) =>
            String(item._id) === String(group._id) ? group : item,
          ),
        );
        setActiveConversation((prev) =>
          prev && String(prev._id) === String(group._id) ? group : prev,
        );
      }

      if (event.type === "group:deleted") {
        const deletedId = String(event.data.conversationId);
        setConversations((prev) =>
          prev.filter((item) => String(item._id) !== deletedId),
        );
        setNotifications((prev) =>
          prev.filter((item) => String(item.conversationId) !== deletedId),
        );
        if (String(activeConversation?._id || "") === deletedId) {
          setActiveConversation(null);
          setMessages([]);
        }
      }

      if (event.type === "error") {
        console.error("WebSocket error event:", event.data?.message);
      }
    },
    [
      activeConversation,
      setMessages,
      setNotifications,
      setConversations,
      setActiveConversation,
      user,
    ],
  );

  const {
    status: connectionStatus,
    sendMessage,
    setActiveConversation: setWsActiveConversation,
    clearActiveConversation: clearWsActiveConversation,
  } = useWebSocket(handleWsEvent);

  useEffect(() => {
    if (!activeConversation?._id) return undefined;
    setWsActiveConversation(activeConversation._id);
    return () => clearWsActiveConversation(activeConversation._id);
  }, [
    activeConversation?._id,
    connectionStatus,
    clearWsActiveConversation,
    setWsActiveConversation,
  ]);

  return { connectionStatus, sendMessage };
}
