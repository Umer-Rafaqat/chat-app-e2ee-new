/*
 * One-time / operator script: promote (or demote) an EXISTING user.
 *
 *   npm run make-admin -- user@example.com
 *   npm run make-admin -- user@example.com --revoke
 *
 * Runs directly against the database from a shell on the server, so there is
 * no HTTP endpoint that can be abused to become admin. It also backfills the
 * `role` field on users created before roles existed.
 */
require("dotenv/config");
const mongoose = require("mongoose");
const User = require("../models/User");
const { ROLES } = require("../config/roles");

async function main() {
  const [emailArg, flag] = process.argv.slice(2);

  if (!emailArg) {
    console.error("Usage: npm run make-admin -- <email> [--revoke]");
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  // Backfill: existing users have no stored role yet.
  const backfill = await User.updateMany(
    { role: { $exists: false } },
    { $set: { role: ROLES.USER } },
  );
  if (backfill.modifiedCount) {
    console.log(`Backfilled role=user on ${backfill.modifiedCount} user(s)`);
  }

  const role = flag === "--revoke" ? ROLES.USER : ROLES.ADMIN;
  const user = await User.findOneAndUpdate(
    { email: emailArg.trim().toLowerCase() },
    { role },
    { returnDocument: "after" },
  );

  if (!user) {
    console.error(`No user found with email ${emailArg}. They must sign up first.`);
    process.exitCode = 1;
  } else {
    console.log(`${user.email} is now: ${user.role}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
