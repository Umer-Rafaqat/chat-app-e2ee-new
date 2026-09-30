import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { RoleBadge, StatusBadge } from "../../components/admin-badges";

function AdminUserDetail() {
  const { id } = useParams();
  const { user: me } = useAuth();
  const isMe = id === String(me?._id || me?.id);

  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getAdminUser(id).then(setDetail).catch((err) => setError(err.message));
  }, [id]);

  const update = async (action) => {
    try {
      const user = await action();
      setDetail((prev) => ({ ...prev, user }));
    } catch (err) {
      alert(err.message);
    }
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) return <p className="text-sm text-slate-400">Loading…</p>;

  const { user, groups, messageCount } = detail;

  return (
    <div className="max-w-2xl">
      <Link to="/admin/users" className="text-sm font-semibold text-blue-600 hover:underline">
        ← All users
      </Link>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold text-slate-900">{user.name}</h2>
            <p className="truncate text-sm text-slate-500">{user.email}</p>
          </div>
          <div className="flex gap-2">
            <RoleBadge role={user.role} />
            <StatusBadge disabled={user.accountDisabled} />
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs font-semibold text-slate-500">Joined</dt><dd>{new Date(user.createdAt).toLocaleDateString()}</dd></div>
          <div><dt className="text-xs font-semibold text-slate-500">Messages sent</dt><dd>{messageCount}</dd></div>
          <div><dt className="text-xs font-semibold text-slate-500">Groups</dt><dd>{groups.length}</dd></div>
        </dl>

        {groups.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-semibold text-slate-500">Member of</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {groups.map((g) => (
                <span key={g._id} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{g.name}</span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
          {isMe ? (
            <p className="text-xs text-slate-400">You can’t change your own role or status.</p>
          ) : (
            <>
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  window.confirm(`Make ${user.email} ${user.role === "admin" ? "a regular user" : "an admin"}?`) &&
                  update(() => api.updateUserRole(user._id, user.role === "admin" ? "user" : "admin"))
                }
              >
                {user.role === "admin" ? "Remove admin" : "Make admin"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  (user.accountDisabled || window.confirm(`Disable ${user.email}?`)) &&
                  update(() => api.updateUserStatus(user._id, !user.accountDisabled))
                }
              >
                {user.accountDisabled ? "Enable account" : "Disable account"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminUserDetail;
