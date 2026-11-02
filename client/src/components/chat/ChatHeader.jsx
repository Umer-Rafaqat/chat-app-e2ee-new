import { useState } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import NotificationPanel from "./NotificationPanel";

function ChatHeader({
  activeConversation,
  currentUserId,
  connectionStatus,
  voiceCall,
  notifications,
  pushStatus,
  onEnablePushNotifications,
  onSelectNotification,
  onOpenMembers,
  onLogout,
}) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  const otherUser = activeConversation?.participants?.find(
    (user) => String(user._id || user.id) !== String(currentUserId),
  );

  const title = activeConversation
    ? activeConversation.isGroup
      ? activeConversation.name || "Unnamed group"
      : otherUser?.name || "Unknown user"
    : "Select a conversation";

  const subtitle = activeConversation
    ? activeConversation.isGroup
      ? `${activeConversation.participants?.length || 0} members`
      : "Direct message"
    : "Choose a conversation to start chatting";

  const isConnected = connectionStatus === "connected";
  const canStartCall =
    activeConversation &&
    voiceCall?.call.status === "idle" &&
    isConnected;

  return (
    <header className="chat-header relative">
      <div className="flex min-w-0 items-center gap-3">
        {activeConversation ? (
          <Avatar
            name={title}
            isGroup={activeConversation.isGroup}
            size="lg"
            online={isConnected && !activeConversation.isGroup}
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            ?
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-slate-900">{title}</h2>
          <div className="mt-0.5 flex items-center gap-2">
            {activeConversation && !activeConversation.isGroup && (
              <span
                className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-500" : "bg-slate-300"}`}
              />
            )}
            <p className="truncate text-xs text-slate-400">{subtitle}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {canStartCall && (
          <button
            type="button"
            onClick={voiceCall.startCall}
            className="header-action px-3 text-xs font-semibold"
            aria-label={`Start ${activeConversation.isGroup ? "group " : ""}voice call with ${title}`}
            title={activeConversation.isGroup ? "Start group voice call" : "Start voice call"}
          >
            Call
          </button>
        )}

        {activeConversation?.isGroup && (
          <button
            type="button"
            onClick={onOpenMembers}
            className="header-action hidden sm:flex"
            title="Group members"
          >
            <Icon name="users" size={18} />
            <span>{activeConversation.participants?.length || 0}</span>
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setIsNotificationOpen((open) => !open)}
            className="header-action relative"
            aria-label="Notifications"
            title="Notifications"
          >
            <Icon name="bell" size={18} />
            {notifications.length > 0 && (
              <span className="notification-dot">
                {notifications.length > 99 ? "99+" : notifications.length}
              </span>
            )}
          </button>
          {isNotificationOpen && (
            <NotificationPanel
              notifications={notifications}
              pushStatus={pushStatus}
              onEnablePushNotifications={onEnablePushNotifications}
              onSelectNotification={(notification) => {
                onSelectNotification(notification);
                setIsNotificationOpen(false);
              }}
            />
          )}
        </div>

        <div className="connection-pill">
          <span
            className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500" : connectionStatus === "connecting" ? "bg-amber-400" : "bg-red-400"}`}
          />
          <span className="hidden md:inline">
            {isConnected
              ? "Connected"
              : connectionStatus === "connecting"
                ? "Connecting"
                : "Disconnected"}
          </span>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="header-action px-3 text-xs font-semibold"
          title="Logout"
        >
          <Icon name="logout" size={17} />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
      {voiceCall?.call.error && (
        <div className="absolute left-1/2 top-full z-30 mt-1 -translate-x-1/2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-700 shadow-lg" role="alert">
          <span>{voiceCall.call.error}</span>
          <button
            type="button"
            onClick={voiceCall.clearCallError}
            className="ml-2 font-semibold"
            aria-label="Dismiss voice call error"
          >
            Dismiss
          </button>
        </div>
      )}
    </header>
  );
}

export default ChatHeader;
