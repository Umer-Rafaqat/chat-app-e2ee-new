import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";
import { AuthContext } from "./auth-context";
import { getMyPublicKeyJwk } from "../lib/e2ee";

// Generates this browser's E2EE key pair on first use (cheap/idempotent —
// see lib/e2ee.js) and uploads the public half if the server doesn't
// already have this exact key (new account, new browser, or a server
// that lost it). The private key never leaves this function's call stack.
function samePublicKey(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

async function syncPublicKey(user) {
  if (!user) return;
  try {
    const localJwk = await getMyPublicKeyJwk();
    if (!samePublicKey(user.publicKey, localJwk)) {
      await api.updatePublicKey(localJwk);
    }
  } catch (error) {
    // Not fatal to being logged in — messaging will just fail until this
    // succeeds (e.g. on next reload), which the UI surfaces explicitly.
    console.error("Failed to sync E2EE public key:", error);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getMe()
      .then((loadedUser) => {
        setUser(loadedUser);
        syncPublicKey(loadedUser);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (credentials) => {
    const loggedInUser = await api.login(credentials);
    setUser(loggedInUser);
    await syncPublicKey(loggedInUser);
  };

  const register = async (payload) => {
    const newUser = await api.register(payload);
    setUser(newUser);
    await syncPublicKey(newUser);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  // Re-read the user (and role) from the server — the server is the source
  // of truth.
  const refreshUser = useCallback(async () => {
    try {
      const refreshed = await api.getMe();
      setUser(refreshed);
      syncPublicKey(refreshed);
    } catch (error) {
      // Keep the current session on transient failures; a disabled account
      // is rejected by the server on its next request anyway.
      console.error("Failed to refresh user:", error);
    }
  }, []);

  // UI convenience only. Every admin action is re-checked by the backend.
  const isAdmin = user?.role === "admin";

  return (
    <AuthContext.Provider
      value={{ user, loading, isAdmin, login, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
