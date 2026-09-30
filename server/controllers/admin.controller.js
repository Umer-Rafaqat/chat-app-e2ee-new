const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const adminService = require("../services/admin.service");
const conversationService = require("../services/conversation.service");
const { listUsersQuerySchema } = require("../validators/admin.validator");

const getStats = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await adminService.getStats() });
});

const listUsers = asyncHandler(async (req, res) => {
  // Express 5 makes req.query read-only, so validate into a local value.
  const { error, value } = listUsersQuerySchema.validate(req.query, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw new AppError(error.details.map((d) => d.message).join(", "), 400);
  }

  const data = await adminService.listUsers(value);
  res.status(200).json({ success: true, data });
});

const getUser = asyncHandler(async (req, res) => {
  const data = await adminService.getUserDetail(req.params.id);
  res.status(200).json({ success: true, data });
});

const updateUserStatus = asyncHandler(async (req, res) => {
  const user = await adminService.setUserStatus(
    req.user._id,
    req.params.id,
    req.body.accountDisabled,
  );
  res.status(200).json({ success: true, data: user });
});

const updateUserRole = asyncHandler(async (req, res) => {
  const user = await adminService.setUserRole(
    req.user._id,
    req.params.id,
    req.body.role,
  );
  res.status(200).json({ success: true, data: user });
});

const getGroups = asyncHandler(async (req, res) => {
  const groups = await conversationService.getAllGroups();
  res.status(200).json({ success: true, data: groups });
});

module.exports = {
  getStats,
  listUsers,
  getUser,
  updateUserStatus,
  updateUserRole,
  getGroups,
};
