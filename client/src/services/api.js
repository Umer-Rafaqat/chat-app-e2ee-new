const BASE_URL = import.meta.env.VITE_API_URL;

async function request(path, options = {}) {
  const headers = {
    ...options.headers,
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body.message || "Something went wrong");
  }

  return body.data;
}

async function uploadImage(conversationId, file) {
  const formData = new FormData();

  formData.append("image", file);

  return request(`/conversations/${conversationId}/messages/upload`, {
    method: "POST",
    body: formData,
  });
}

export const api = {
  register: (payload) =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  login: (payload) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  logout: () =>
    request("/auth/logout", {
      method: "POST",
    }),

  getMe: () => request("/auth/me"),

  // E2EE: upload/replace this user's public key.
  updatePublicKey: (publicKey) =>
    request("/users/me/public-key", {
      method: "PUT",
      body: JSON.stringify({ publicKey }),
    }),

  getUsers: () => request("/users"),

  getConversations: () => request("/conversations"),

  createConversation: (participantId) =>
    request("/conversations", {
      method: "POST",
      body: JSON.stringify({
        participantId,
      }),
    }),

  createGroup: (name, participantIds) =>
    request("/conversations/group", {
      method: "POST",
      body: JSON.stringify({
        name,
        participantIds,
      }),
    }),

  // -------------------------
  // Group management (admin only — enforced by the server)
  // -------------------------

  updateGroup: (conversationId, name) =>
    request(`/conversations/${conversationId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  deleteGroup: (conversationId) =>
    request(`/conversations/${conversationId}`, { method: "DELETE" }),

  // -------------------------
  // Admin panel (admin only — enforced by the server)
  // -------------------------

  getAdminStats: () => request("/admin/stats"),

  getAdminUsers: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== "" && v != null),
    ).toString();
    return request(`/admin/users${qs ? `?${qs}` : ""}`);
  },

  getAdminUser: (id) => request(`/admin/users/${id}`),

  updateUserStatus: (id, accountDisabled) =>
    request(`/admin/users/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ accountDisabled }),
    }),

  updateUserRole: (id, role) =>
    request(`/admin/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  getAdminGroups: () => request("/admin/groups"),

  getMessages: (conversationId) =>
    request(`/conversations/${conversationId}/messages`),

  uploadImage,

  // -------------------------
  // Notifications
  // -------------------------

  getNotifications: () => request("/notifications"),

  getNotificationCount: () => request("/notifications/count"),

  deleteConversationNotifications: (conversationId) =>
    request(`/notifications/conversation/${conversationId}`, {
      method: "DELETE",
    }),

  // -------------------------
  // Firebase Push
  // -------------------------

  registerPushInstallation: (installationId) =>
    request("/push/register", {
      method: "POST",
      body: JSON.stringify({
        installationId,
      }),
    }),

  unregisterPushInstallation: (installationId) =>
    request("/push/register", {
      method: "DELETE",
      body: JSON.stringify({
        installationId,
      }),
    }),
};
