const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const AppError = require("../utils/AppError");
const { ROLES } = require("../config/roles");

const { JWT_SECRET, JWT_EXPIRES_IN } = require("../config/env");
const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS_PER_LEVEL = 5;
const MAX_LOCK_LEVEL = 10;
const INITIAL_LOCK_SECONDS = 5;

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function getLockDurationSeconds(lockLevel) {
  return INITIAL_LOCK_SECONDS * lockLevel;
}

function getRemainingLockSeconds(lockedUntil) {
  if (!lockedUntil) {
    return 0;
  }

  const remainingMs = new Date(lockedUntil).getTime() - Date.now();

  return Math.max(0, Math.ceil(remainingMs / 1000));
}

async function registerUser({ name, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await User.findOne({
    email: normalizedEmail,
  });

  if (existing) {
    throw new AppError("Email already in use", 409);
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  // role is set explicitly so it can never come from the request payload.
  const user = await User.create({
    name,
    email: normalizedEmail,
    password: hashedPassword,
    role: ROLES.USER,
  });

  const token = signToken(user._id);

  return {
    token,

    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      publicKey: user.publicKey,
    },
  };
}

async function loginUser({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({
    email: normalizedEmail,
  }).select("+password");

  if (!user) {
    throw new AppError("Invalid email or password", 401);
  }

  if (user.accountDisabled) {
    throw new AppError(
      "Your account has been disabled. Account verification is required before you can log in again.",
      403,
    );
  }

  if (user.loginLockedUntil) {
    const remainingSeconds = getRemainingLockSeconds(user.loginLockedUntil);

    if (remainingSeconds > 0) {
      throw new AppError(
        `Too many failed login attempts. Try again in ${remainingSeconds} seconds.`,
        429,
      );
    }

    // Once the lock window expires, the user should start a fresh cycle.
    // Leaving the prior lock level or failure count in place would make the
    // next failed attempt escalate immediately instead of beginning a new block.
    user.loginFailedAttempts = 0;
    user.loginLockLevel = 0;
    user.loginLockedUntil = null;

    await user.save();
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    user.loginFailedAttempts += 1;

    if (user.loginFailedAttempts >= MAX_FAILED_ATTEMPTS_PER_LEVEL) {
      // Increase lock level.
      user.loginLockLevel += 1;

      // Start a new 5-attempt cycle.
      user.loginFailedAttempts = 0;

      if (user.loginLockLevel >= MAX_LOCK_LEVEL) {
        user.accountDisabled = true;
        user.verificationRequired = true;
        user.loginLockedUntil = null;

        await user.save();

        throw new AppError(
          "Your account has been disabled after repeated failed login attempts. Account verification is required.",
          403,
        );
      }

      const lockSeconds = getLockDurationSeconds(user.loginLockLevel);

      user.loginLockedUntil = new Date(Date.now() + lockSeconds * 1000);

      await user.save();

      throw new AppError(
        `Too many failed login attempts. Try again in ${lockSeconds} seconds.`,
        429,
      );
    }

    await user.save();

    const attemptsRemaining =
      MAX_FAILED_ATTEMPTS_PER_LEVEL - user.loginFailedAttempts;

    throw new AppError(
      `Invalid email or password. ${attemptsRemaining} attempt${
        attemptsRemaining === 1 ? "" : "s"
      } remaining.`,
      401,
    );
  }

  user.loginFailedAttempts = 0;
  user.loginLockLevel = 0;
  user.loginLockedUntil = null;

  await user.save();

  const token = signToken(user._id);

  return {
    token,

    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      publicKey: user.publicKey,
    },
  };
}

module.exports = {
  registerUser,
  loginUser,
};
