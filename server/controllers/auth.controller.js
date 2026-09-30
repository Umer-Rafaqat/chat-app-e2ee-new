const asyncHandler = require("../utils/asyncHandler");
const authService = require("../services/auth.service");
const { NODE_ENV } = require("../config/env");

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const register = asyncHandler(async (req, res) => {
  const { token, user } = await authService.registerUser(req.body);
  res.cookie("token", token, COOKIE_OPTIONS);
  res.status(201).json({ success: true, data: user });
});

const login = asyncHandler(async (req, res) => {
  const { token, user } = await authService.loginUser(req.body);
  res.cookie("token", token, COOKIE_OPTIONS);
  res.status(200).json({ success: true, data: user });
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie("token", COOKIE_OPTIONS);
  res.status(200).json({ success: true, message: "Logged out" });
});

const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      publicKey: req.user.publicKey,
    },
  });
});

module.exports = { register, login, logout, getMe };
