const mongoose = require("mongoose");
const { MONGO_URI } = require("./env");

let connecting;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;

  const attempt =
    (connecting ??= mongoose.connect(MONGO_URI).catch((error) => {
      connecting = undefined;
      throw error;
    }));

  await attempt;
  if (connecting === attempt) connecting = undefined;
  console.log("MongoDB connected");
}

module.exports = connectDB;
