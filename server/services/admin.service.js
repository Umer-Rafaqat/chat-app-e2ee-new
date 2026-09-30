const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const AppError = require("../utils/AppError");
const { ROLES } = require("../config/roles");
const connectionManager = require("../websocket/connection.manager");

const ADMIN_USER_FIELDS =
  "name email role accountDisabled verificationRequired loginLockedUntil createdAt updatedAt";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function getStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalUsers, admins, disabledUsers, newUsers, groups, messages] =
    await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: ROLES.ADMIN }),
      User.countDocuments({ accountDisabled: true }),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      Conversation.countDocuments({ isGroup: true }),
      Message.countDocuments(),
    ]);

  return {
    totalUsers,
    admins,
    disabledUsers,
    newUsersThisWeek: newUsers,
    groups,
    messages,
    onlineUsers: connectionManager.onlineCount(),
  };
}

async function listUsers({ search, role, status, page, limit }) {
  const filter = {};

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: pattern }, { email: pattern }];
  }
  if (role) filter.role = role;
  if (status) filter.accountDisabled = status === "disabled";

  const [users, total] = await Promise.all([
    User.find(filter)
      .select(ADMIN_USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  return {
    users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

async function getUserDetail(userId) {
  const user = await User.findById(userId).select(ADMIN_USER_FIELDS);

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const [groups, messageCount] = await Promise.all([
    Conversation.find({ isGroup: true, participants: userId }).select("name"),
    Message.countDocuments({ sender: userId }),
  ]);

  return { user, groups, messageCount };
}

function assertNotSelf(actorId, targetId, action) {
  // Prevents an admin from locking themselves (or the last admin) out.
  if (String(actorId) === String(targetId)) {
    throw new AppError(`You cannot ${action} your own account`, 400);
  }
}

async function setUserStatus(actorId, targetId, accountDisabled) {
  assertNotSelf(actorId, targetId, "change the status of");

  const update = { accountDisabled };

  if (!accountDisabled) {
    // Re-enabling clears the lockout state left by failed-login protection.
    Object.assign(update, {
      verificationRequired: false,
      loginFailedAttempts: 0,
      loginLockLevel: 0,
      loginLockedUntil: null,
    });
  }

  const user = await User.findByIdAndUpdate(targetId, update, {
    returnDocument: "after",
  }).select(ADMIN_USER_FIELDS);

  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (accountDisabled) {
    connectionManager.disconnectUser(targetId, 4003, "Account disabled");
  }

  return user;
}

async function setUserRole(actorId, targetId, role) {
  assertNotSelf(actorId, targetId, "change the role of");

  const user = await User.findByIdAndUpdate(
    targetId,
    { role },
    { returnDocument: "after", runValidators: true },
  ).select(ADMIN_USER_FIELDS);

  if (!user) {
    throw new AppError("User not found", 404);
  }

  // Tell the affected user's open tab to re-read its role from the server.
  connectionManager.sendToUser(targetId, {
    type: "auth:role_changed",
    data: { role: user.role },
  });

  return user;
}

module.exports = {
  getStats,
  listUsers,
  getUserDetail,
  setUserStatus,
  setUserRole,
};
