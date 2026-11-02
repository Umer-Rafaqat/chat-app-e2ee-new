import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";
import ChatLayout from "../components/ChatLayout";
import useChatPush from "../hooks/chat/useChatPush";
import useChatRealtime, {
  normalizeNotification,
} from "../hooks/chat/useChatRealtime";
import useVoiceCall from "../hooks/chat/useVoiceCall";
import {
  decryptMessage,
  encryptMessage,
  ensureAllParticipantsHaveKeys,
  toEncryptionParticipants,
} from "../lib/e2ee";

function getUserId(user) {
  return user?._id || user?.id;
}

// Live incoming messages are decrypted inside useChatRealtime; a freshly
// loaded conversation's history (REST) is decrypted here, so <MessageList>
// never has to know encryption exists — it just renders `message.content`.
async function decryptHistory(messages, myUserId) {
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      content: await decryptMessage(message, myUserId),
    })),
  );
}

function Chat() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const myUserId = getUserId(user);

  const [conversations, setConversations] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [notifications, setNotifications] = useState([]);

  const { pushStatus, handleEnablePushNotifications } = useChatPush();
  const { connectionStatus, sendMessage } = useChatRealtime({
    user,
    activeConversation,
    setMessages,
    setNotifications,
    setConversations,
    setActiveConversation,
  });
  const voiceCall = useVoiceCall({
    activeConversation,
    connectionStatus,
    currentUserId: myUserId,
  });

  const loadMessages = useCallback(
    async (conversationId) => {
      setLoadingMessages(true);
      try {
        const raw = await api.getMessages(conversationId);
        setMessages(await decryptHistory(raw, myUserId));
      } catch (error) {
        console.error("Failed to load messages:", error);
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [myUserId],
  );

  const clearConversationNotifications = useCallback(async (conversationId) => {
    try {
      await api.deleteConversationNotifications(String(conversationId));
    } catch (error) {
      console.error("Failed to remove conversation notifications:", error);
    }

    setNotifications((prev) =>
      prev.filter(
        (notification) =>
          String(notification.conversationId) !== String(conversationId),
      ),
    );
  }, []);

  const handleSelectConversation = useCallback(
    async (conversation) => {
      setActiveConversation(conversation);
      await loadMessages(conversation._id);
      await clearConversationNotifications(conversation._id);
    },
    [clearConversationNotifications, loadMessages],
  );

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [conversationData, userData, notificationData] =
          await Promise.all([
            api.getConversations(),
            api.getUsers(),
            api.getNotifications(),
          ]);

        setConversations(conversationData);
        setUsers(userData);
        setNotifications(notificationData.map(normalizeNotification));

        const conversationId = searchParams.get("conversationId");
        const conversation = conversationData.find(
          (item) => String(item._id) === String(conversationId),
        );

        if (conversation) {
          await handleSelectConversation(conversation);
          navigate("/chat", { replace: true });
        }
      } catch (error) {
        console.error("Failed to load chat data:", error);
      }
    }

    loadInitialData();
    // Runs once on mount; handleSelectConversation is stable enough here
    // and re-running this on every render would re-fetch everything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, searchParams]);

  const handleSelectNotification = useCallback(
    async (notification) => {
      const conversation = conversations.find(
        (item) => String(item._id) === String(notification.conversationId),
      );
      if (!conversation) return;
      await handleSelectConversation(conversation);
    },
    [conversations, handleSelectConversation],
  );

  const handleSelectUser = async (selectedUser) => {
    try {
      const conversation = await api.createConversation(selectedUser._id);
      setConversations((prev) =>
        prev.some((item) => String(item._id) === String(conversation._id))
          ? prev
          : [conversation, ...prev],
      );
      await handleSelectConversation(conversation);
    } catch (error) {
      console.error("Failed to start conversation:", error);
    }
  };

  // Encrypts client-side before anything goes over the wire — the server
  // only ever sees ciphertext. Works the same for a 1-on-1 chat or a group;
  // the participant list is whatever the (already-loaded) conversation has.
  const handleSendMessage = async (text) => {
    if (!activeConversation) return;

    try {
      const participants = toEncryptionParticipants(activeConversation);
      ensureAllParticipantsHaveKeys(participants);
      const payload = await encryptMessage(text, participants);
      sendMessage(activeConversation._id, payload, "message");
    } catch (error) {
      console.error("Failed to send message:", error);
      alert(error.message || "Failed to send message");
    }
  };

  const handleSendImage = async (file) => {
    if (!activeConversation) return;
    try {
      // Images are uploaded as-is (not end-to-end encrypted yet).
      const result = await api.uploadImage(activeConversation._id, file);
      sendMessage(activeConversation._id, { imageUrl: result.imageUrl }, "image");
    } catch (error) {
      console.error("Image upload failed:", error);
    }
  };

  const handleCreateGroup = async (name, participantIds) => {
    try {
      const group = await api.createGroup(name, participantIds);
      // The server also broadcasts group:created; de-duplicate by id.
      setConversations((prev) =>
        prev.some((item) => String(item._id) === String(group._id))
          ? prev
          : [group, ...prev],
      );
      setActiveConversation(group);
      setMessages([]);
      return group;
    } catch (error) {
      console.error("Group creation failed:", error);
      alert(error.message);
      throw error;
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <ChatLayout
      conversations={conversations}
      users={users}
      activeConversation={activeConversation}
      messages={loadingMessages ? [] : messages}
      currentUserId={myUserId}
      currentUser={user}
      isAdmin={isAdmin}
      knownUsers={[...(activeConversation?.participants || []), ...users]}
      connectionStatus={connectionStatus}
      voiceCall={voiceCall}
      notifications={notifications}
      pushStatus={pushStatus}
      onEnablePushNotifications={handleEnablePushNotifications}
      onSelectConversation={handleSelectConversation}
      onSelectNotification={handleSelectNotification}
      onSelectUser={handleSelectUser}
      onSendMessage={handleSendMessage}
      onSendImage={handleSendImage}
      onLogout={handleLogout}
      onCreateGroup={handleCreateGroup}
    />
  );
}

export default Chat;
