import { useEffect, useState, useCallback } from "react";

import { useAuth } from "../hooks/useAuth";

import WebSocketService from "../services/websocket";

import { WebSocketContext } from "./websocket-context";

const WS_URL = import.meta.env.VITE_WS_URL;

export function WebSocketProvider({ children }) {
  const { user } = useAuth();

  const [status, setStatus] = useState("disconnected");

  const [service] = useState(() => new WebSocketService(WS_URL));

  useEffect(() => {
    if (!user) return;

    const unsubscribeStatus = service.onStatusChange(setStatus);

    service.connect();

    return () => {
      unsubscribeStatus();

      service.disconnect();
    };
  }, [user, service]);

  // `data` is either:
  //   { imageUrl }                     for type "image" (not E2EE'd)
  //   { ciphertext, iv, keys }         for type "message" (E2EE'd — see lib/e2ee.js)
  // This component stays crypto-agnostic; it just forwards whatever the
  // caller already encrypted.
  const sendMessage = useCallback(
    (conversationId, data, type = "message") => {
      service.send({ type, conversationId, data });
    },
    [service],
  );

  /*
   * Set currently open conversation.
   */
  const setActiveConversation = useCallback(
    (conversationId) => {
      service.setActiveConversation(conversationId);
    },
    [service],
  );

  /*
   * Clear currently open conversation.
   */
  const clearActiveConversation = useCallback(
    (conversationId) => {
      service.clearActiveConversation(conversationId);
    },
    [service],
  );

  const subscribe = useCallback(
    (listener) => service.onMessage(listener),
    [service],
  );

  return (
    <WebSocketContext.Provider
      value={{
        status,

        sendMessage,

        setActiveConversation,

        clearActiveConversation,

        subscribe,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}
