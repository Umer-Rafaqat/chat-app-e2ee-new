import { Link } from "react-router-dom";
import ConversationList from "../ConversationList";
import Avatar from "./Avatar";
import Icon from "./Icon";

function ChatSidebar({
  conversations,
  users,
  activeConversation,
  currentUserId,
  currentUser,
  isAdmin = false,
  onSelectConversation,
  onSelectUser,
  onCreateGroup,
}) {
  const availableUsers = users.filter(
    (item) => String(item._id || item.id) !== String(currentUserId),
  );

  return (
    <aside className="chat-sidebar">
      <div className="border-b border-slate-200 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
              <span className="text-lg font-bold">C</span>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900">
                ChatApp
              </h1>
              <p className="text-xs text-slate-500">
                {currentUser?.name || "Your workspace"}
              </p>
            </div>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={onCreateGroup}
              className="icon-button border border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
              title="Create group"
              aria-label="Create group"
            >
              <Icon name="plus" size={18} />
            </button>
          )}
        </div>

        <div className="relative mt-5">
          <Icon
            name="search"
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            placeholder="Search conversations..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {isAdmin && (
          <>
            <button
              type="button"
              onClick={onCreateGroup}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.99]"
            >
              <Icon name="plus" size={16} />
              New group
            </button>
            <Link
              to="/admin"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
            >
              <Icon name="users" size={16} />
              Admin Panel
            </Link>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <p className="section-label">Conversations</p>
          <span className="text-xs text-slate-400">{conversations.length}</span>
        </div>

        <div className="h-[calc(100%-42px)] overflow-y-auto px-2">
          <ConversationList
            conversations={conversations}
            currentUserId={currentUserId}
            activeId={activeConversation?._id}
            onSelect={onSelectConversation}
          />
        </div>
      </div>

      <div className="border-t border-slate-200 px-3 py-3">
        <p className="section-label px-2 pb-2">Start a conversation</p>
        <div className="max-h-28 overflow-y-auto">
          {availableUsers.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-400">
              No other users found.
            </p>
          ) : (
            availableUsers.map((item) => (
              <button
                key={item._id || item.id}
                type="button"
                onClick={() => onSelectUser(item)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50"
              >
                <Avatar name={item.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-700">
                    {item.name || "Unknown User"}
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {item.email}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

export default ChatSidebar;
