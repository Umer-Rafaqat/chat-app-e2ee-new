// Framework-agnostic wrapper around the native WebSocket API.
// Knows nothing about React — WebSocketContext.jsx binds this into React.

class WebSocketService {
  constructor(url) {
    this.url = url;

    this.ws = null;

    this.messageListeners = new Set();

    this.statusListeners = new Set();

    this.reconnectAttempts = 0;

    this.reconnectTimer = null;

    this.manualClose = false;

    /*
     * Conversation currently visible
     * to this user.
     */
    this.activeConversationId = null;
  }

  connect() {
    this.manualClose = false;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this._emitStatus("connecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      if (this.ws !== ws) return;

      this.reconnectAttempts = 0;
      this._emitStatus("connected");

      /*
       * If the user already had a conversation
       * open before reconnecting, tell the server
       * about it again.
       */
      this._sendActiveConversation();
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;

      this.ws = null;
      this._emitStatus("disconnected");

      if (!this.manualClose) {
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
        this.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, delay);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.messageListeners.forEach((listener) =>
          listener({ type: "call:audio", data: event.data }),
        );
        return;
      }

      let parsed;

      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      this.messageListeners.forEach((listener) => listener(parsed));
    };
  }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    this.ws?.close();

    this.ws = null;
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("Cannot send — WebSocket is not connected");

      return false;
    }

    this.ws.send(JSON.stringify(payload));

    return true;
  }

  sendBinary(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    if (this.ws.bufferedAmount > 64 * 1024) {
      return false;
    }

    this.ws.send(data);
    return true;
  }

  /*
   * Tell server which conversation
   * is currently open.
   */
  setActiveConversation(conversationId) {
    this.activeConversationId = conversationId ? String(conversationId) : null;

    this._sendActiveConversation();
  }

  /*
   * Tell server that conversation
   * is no longer active.
   */
  clearActiveConversation(conversationId) {
    const id = conversationId ? String(conversationId) : null;

    if (!id || this.activeConversationId === id) {
      this.activeConversationId = null;
    }

    if (id) {
      this.send({
        type: "conversation:close",

        conversationId: id,
      });
    }
  }

  /*
   * Send currently active conversation
   * to the server.
   */
  _sendActiveConversation() {
    if (!this.activeConversationId) {
      return;
    }

    this.send({
      type: "conversation:open",

      conversationId: this.activeConversationId,
    });
  }

  onMessage(listener) {
    this.messageListeners.add(listener);

    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener) {
    this.statusListeners.add(listener);

    return () => this.statusListeners.delete(listener);
  }

  _emitStatus(status) {
    this.statusListeners.forEach((listener) => listener(status));
  }
}

export default WebSocketService;
