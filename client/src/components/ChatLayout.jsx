import { useState } from "react";
import ChatSidebar from "./chat/ChatSidebar";
import ChatHeader from "./chat/ChatHeader";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import CreateGroupModal from "./modals/CreateGroupModal";
import GroupMembersModal from "./modals/GroupMembersModal";
import VoiceCallModal from "./modals/VoiceCallModal";

function ChatLayout({
  conversations,
  users,
  activeConversation,
  messages,
  currentUserId,
  currentUser,
  isAdmin = false,
  knownUsers,
  connectionStatus,
  voiceCall,
  notifications = [],
  onSelectNotification,
  pushStatus,
  onEnablePushNotifications,
  onSelectConversation,
  onSelectUser,
  onSendMessage,
  onSendImage,
  onLogout,
  onCreateGroup,
}) {
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);

  return (
    <div className="chat-shell">
      <ChatSidebar
        conversations={conversations}
        users={users}
        activeConversation={activeConversation}
        currentUserId={currentUserId}
        currentUser={currentUser}
        isAdmin={isAdmin}
        onSelectConversation={onSelectConversation}
        onSelectUser={onSelectUser}
        onCreateGroup={() => setIsGroupModalOpen(true)}
      />

      <main className="chat-main">
        <ChatHeader
          activeConversation={activeConversation}
          currentUserId={currentUserId}
          connectionStatus={connectionStatus}
          voiceCall={voiceCall}
          notifications={notifications}
          pushStatus={pushStatus}
          onEnablePushNotifications={onEnablePushNotifications}
          onSelectNotification={onSelectNotification}
          onOpenMembers={() => setIsMembersModalOpen(true)}
          onLogout={onLogout}
        />

        {activeConversation ? (
          <>
            <MessageList
              messages={messages}
              currentUserId={currentUserId}
              knownUsers={knownUsers}
              isGroup={activeConversation.isGroup}
            />
            <MessageInput
              onSend={onSendMessage}
              onSendImage={onSendImage}
              disabled={connectionStatus !== "connected"}
            />
          </>
        ) : (
          <div className="chat-empty">
            <div className="mx-auto max-w-sm text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-2xl shadow-sm">
                💬
              </div>
              <h2 className="mt-5 text-lg font-bold text-slate-800">
                Your conversations
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Select a conversation from the sidebar, or start a new chat
                below.
              </p>
            </div>
          </div>
        )}
      </main>

      {isAdmin && isGroupModalOpen && (
        <CreateGroupModal
          users={users}
          currentUserId={currentUserId}
          onClose={() => setIsGroupModalOpen(false)}
          onCreate={onCreateGroup}
        />
      )}

      {isMembersModalOpen && (
        <GroupMembersModal
          conversation={activeConversation}
          currentUserId={currentUserId}
          onClose={() => setIsMembersModalOpen(false)}
        />
      )}

      <VoiceCallModal
        call={voiceCall?.call}
        onAccept={voiceCall?.acceptCall}
        onReject={voiceCall?.rejectCall}
        onEnd={voiceCall?.endCall}
        onToggleMute={voiceCall?.toggleMute}
      />
    </div>
  );
}

export default ChatLayout;
