const jwt = require("jsonwebtoken");
const { JWT_SECRET, CLIENT_URLS, NODE_ENV } = require("../config/env");
const User = require("../models/User");
const connectionManager = require("./connection.manager");
const handleMessage = require("./message.handler");

let parseCookiePromise;
const getParseCookie = () =>
  (parseCookiePromise ??= import("cookie").then((m) => m.parseCookie));

function isLocalhostOrigin(origin) {
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

// Runs on the raw HTTP upgrade request, before the socket is accepted.
async function authenticateUpgradeRequest(req) {
  const origin = req.headers.origin;
  const isLocalhost = origin && isLocalhostOrigin(origin);
  const originAllowed =
    CLIENT_URLS.includes(origin) ||
    (NODE_ENV === "development" && isLocalhost);

  if (!originAllowed || (NODE_ENV === "production" && isLocalhost)) {
    throw new Error("Origin not allowed");
  }

  // console.log("Upgrade request cookie header:", req.headers.cookie);
  const parseCookie = await getParseCookie();
  const cookies = parseCookie(req.headers.cookie || "");
  const token = cookies.token;

  if (!token) {
    throw new Error("No auth token provided");
  }

  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
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

  ws.on("message", (raw, isBinary) => {
    handleMessage(ws, userId, raw, isBinary).catch((error) => {
      console.error("WebSocket message handler failed:", error);
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "error",
            data: { message: "Failed to process message" },
          }),
        );
      }
    });
  });

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
