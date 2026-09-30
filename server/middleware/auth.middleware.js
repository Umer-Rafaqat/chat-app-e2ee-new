const jwt = require("jsonwebtoken");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { JWT_SECRET } = require("../config/env");
const User = require("../models/User");

const protect = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    throw new AppError("Not authenticated", 401);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    throw new AppError("Invalid or expired session", 401);
  }

  const user = await User.findById(decoded.id);
  if (!user) {
    throw new AppError("User no longer exists", 401);
  }

  // A disabled account must lose access immediately, not only at next login.
  if (user.accountDisabled) {
    throw new AppError("Your account has been disabled", 403);
  }

  req.user = user; // attach for downstream controllers (includes user.role)
  next();
});

module.exports = protect;
module.exports.authenticateUser = protect; // alias: authenticateUser -> requireAdmin
