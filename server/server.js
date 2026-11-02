const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const attachWebSocketServer = require("./websocket/websocket.server");
const { PORT } = require("./config/env");

const httpServer = http.createServer(app);
attachWebSocketServer(httpServer);

connectDB().catch((error) => {
  console.error("MongoDB connection failed:", error.message);
});

if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = httpServer;
