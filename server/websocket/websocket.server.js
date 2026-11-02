const { WebSocketServer } = require("ws");
const {
  authenticateUpgradeRequest,
  handleConnection,
} = require("./connection.handler");

function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  httpServer.on("upgrade", async (req, socket, head) => {
    try {
      const user = await authenticateUpgradeRequest(req);

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleConnection(ws, user);
      });
    } catch (err) {
      console.error("WS upgrade rejected:", err.message);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    }
  });

  return wss;
}

module.exports = attachWebSocketServer;
