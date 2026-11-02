const { parseCookie } = require("cookie");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");
const User = require("../models/User");
const connectionManager = require("./connection.manager");
const handleMessage = require("./message.handler");

// Runs on the raw HTTP upgrade request, before the socket is accepted.
async function authenticateUpgradeRequest(req) {
  // console.log("Upgrade request cookie header:", req.headers.cookie);
  const cookies = parseCookie(req.headers.cookie || "");
  const token = cookies.token;

  if (!token) {
    throw new Error("No auth token provided");
  }

  const decoded = jwt.verify(token, JWT_SECRET); // throws on invalid/expired
  const user = await User.findById(decoded.id);

  if (!user) {
    throw new Error("User no longer exists");
  }

  if (user.accountDisabled) {
    throw new Error("Account disabled");
  }

  return user;
}

function handleConnection(ws, user) {
  const userId = user._id.toString();

  connectionManager.addConnection(userId, ws);
  console.log(
    `${user.name} connected — ${connectionManager.onlineCount()} online`,
  );

  ws.send(
    JSON.stringify({ type: "connection", data: { status: "connected" } }),
  );

  ws.on("message", (raw, isBinary) =>
    handleMessage(ws, userId, raw, isBinary),
  );

  ws.on("close", () => {
    connectionManager.removeConnection(userId, ws);
    console.log(
      `${user.name} disconnected — ${connectionManager.onlineCount()} online`,
    );
  });

  ws.on("error", (err) => {
    console.error(`WebSocket error (${user.name}):`, err.message);
  });
}

module.exports = { authenticateUpgradeRequest, handleConnection };
