const User = require("../models/User");
const AppError = require("../utils/AppError");

async function getAllUsers(excludeUserId) {
  // Exclude the currently logged-in user — you don't message yourself.
  // publicKey is included so the client can encrypt to every user it can
  // start a conversation with.
  return User.find({ _id: { $ne: excludeUserId } }).select(
    "name email createdAt publicKey",
  );
}

async function getUserById(id) {
  const user = await User.findById(id).select(
    "name email createdAt publicKey",
  );
  if (!user) {
    throw new AppError("User not found", 404);
  }
  return user;
}

// Called once per browser: uploads this user's E2EE public key. Overwrites
// any previous key for this account (e.g. a new device/browser) — the
// caller is warned client-side that older messages won't be readable there.
async function setPublicKey(userId, publicKey) {
  const user = await User.findByIdAndUpdate(
    userId,
    { publicKey },
    { returnDocument: "after", runValidators: true },
  ).select("name email createdAt publicKey");

  if (!user) {
    throw new AppError("User not found", 404);
  }
  return user;
}

module.exports = { getAllUsers, getUserById, setPublicKey };
