import { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import useWebSocket from "../../hooks/useWebSocket";
import CreateGroupModal from "../../components/modals/CreateGroupModal";
import EditGroupModal from "../../components/modals/EditGroupModal";

const sameId = (a, b) => String(a) === String(b);

function AdminGroups() {
  const { user } = useAuth();

  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    Promise.all([api.getAdminGroups(), api.getUsers()])
      .then(([groupData, userData]) => {
        setGroups(groupData);
        setUsers(userData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Live updates: changes made by other admins (or other tabs) arrive here.
  const handleWsEvent = useCallback((event) => {
    if (event.type === "group:created") {
      setGroups((prev) =>
        prev.some((g) => sameId(g._id, event.data._id)) ? prev : [event.data, ...prev],
      );
    }
    if (event.type === "group:updated") {
      setGroups((prev) => prev.map((g) => (sameId(g._id, event.data._id) ? event.data : g)));
    }
    if (event.type === "group:deleted") {
      setGroups((prev) => prev.filter((g) => !sameId(g._id, event.data.conversationId)));
    }
  }, []);
  useWebSocket(handleWsEvent);

  const handleCreate = async (name, participantIds) => {
    const group = await api.createGroup(name, participantIds);
    setGroups((prev) => (prev.some((g) => sameId(g._id, group._id)) ? prev : [group, ...prev]));
    return group;
  };

  const handleRename = async (id, name) => {
    const group = await api.updateGroup(id, name);
    setGroups((prev) => prev.map((g) => (sameId(g._id, group._id) ? group : g)));
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await api.deleteGroup(deleting._id);
      setGroups((prev) => prev.filter((g) => !sameId(g._id, deleting._id)));
      setDeleting(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Groups</h2>
          <p className="mt-1 text-sm text-slate-500">{groups.length} total</p>
        </div>
        <button type="button" className="primary-button" onClick={() => setShowCreate(true)}>
          + Create group
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Members</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!loading && groups.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">No groups yet.</td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={g._id}>
                <td className="px-4 py-3 font-semibold text-slate-800">{g.name || "Unnamed group"}</td>
                <td className="px-4 py-3 text-slate-600">{g.participants?.length || 0}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(g.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button type="button" className="secondary-button" onClick={() => setEditing(g)}>Rename</button>
                    <button
                      type="button"
                      className="secondary-button !border-red-200 !text-red-600 hover:!bg-red-50"
                      onClick={() => setDeleting(g)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateGroupModal
          users={users}
          currentUserId={user?._id || user?.id}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {editing && (
        <EditGroupModal group={editing} onClose={() => setEditing(null)} onSave={handleRename} />
      )}

      {deleting && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && !isDeleting && setDeleting(null)}
        >
          <div className="modal-card">
            <div className="p-5">
              <h2 className="text-base font-bold text-slate-900">Delete “{deleting.name}”?</h2>
              <p className="mt-2 text-sm text-slate-500">
                This permanently deletes the group and all of its messages for every member. This can’t be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button type="button" className="secondary-button" disabled={isDeleting} onClick={() => setDeleting(null)}>Cancel</button>
              <button type="button" className="primary-button !bg-red-600 hover:!bg-red-700" disabled={isDeleting} onClick={handleDelete}>
                {isDeleting ? "Deleting..." : "Delete group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminGroups;
