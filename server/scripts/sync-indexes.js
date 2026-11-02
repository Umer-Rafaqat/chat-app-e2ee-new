const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const connectDB = require("../config/db");

async function syncIndexes() {
  try {
    await connectDB();
    await Conversation.syncIndexes();
    console.log("Conversation indexes synchronized");
  } finally {
    await mongoose.disconnect();
  }
}

syncIndexes().catch((error) => {
  console.error("Failed to synchronize indexes:", error);
  process.exitCode = 1;
});
