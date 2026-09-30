import { useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import useWebSocket from "../hooks/useWebSocket";

// Keeps the client's role in sync with the database: when an admin promotes /
// demotes this user, the server pushes `auth:role_changed` and we re-fetch /me.
function RoleSync() {
  const { refreshUser } = useAuth();

  const handleEvent = useCallback(
    (event) => {
      if (event.type === "auth:role_changed") refreshUser();
    },
    [refreshUser],
  );

  useWebSocket(handleEvent);
  return null;
}

export default RoleSync;
