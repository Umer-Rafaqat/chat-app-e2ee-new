import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { RoleBadge, StatusBadge } from "../../components/admin-badges";

const PAGE_SIZE = 15;

function AdminUsers() {
  const { user: me } = useAuth();
  const myId = String(me?._id || me?.id);

  const [filters, setFilters] = useState({ search: "", role: "", status: "" });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ users: [], pagination: { pages: 1, total: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // Fetch whenever the query changes. State is only set inside the async
  // callbacks (never synchronously in the effect body).
  useEffect(() => {
    let cancelled = false;

    api
      .getAdminUsers({
        search: debouncedSearch,
        role: filters.role,
        status: filters.status,
        page,
        limit: PAGE_SIZE,
      })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError("");
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, filters.role, filters.status, page]);

  const replaceUser = (updated) =>
    setData((prev) => ({
      ...prev,
      users: prev.users.map((u) => (u._id === updated._id ? updated : u)),
    }));

  const toggleStatus = async (target) => {
    const disabling = !target.accountDisabled;
    if (disabling && !window.confirm(`Disable ${target.email}? They will be signed out immediately.`)) return;
    try {
      replaceUser(await api.updateUserStatus(target._id, disabling));
    } catch (err) {
      alert(err.message);
    }
  };

  const changeRole = async (target, role) => {
    if (role === target.role) return;
    if (!window.confirm(`Change ${target.email} to ${role}?`)) return;
    try {
      replaceUser(await api.updateUserRole(target._id, role));
    } catch (err) {
      alert(err.message);
    }
  };

  const setFilter = (key) => (event) => {
    setLoading(true);
    setFilters((prev) => ({ ...prev, [key]: event.target.value }));
    if (key !== "search") setPage(1);
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Users</h2>
      <p className="mt-1 text-sm text-slate-500">{data.pagination.total} total</p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={filters.search}
          onChange={setFilter("search")}
          placeholder="Search name or email…"
          className="field-input sm:max-w-xs"
        />
        <select value={filters.role} onChange={setFilter("role")} className="field-input sm:w-40">
          <option value="">All roles</option>
          <option value="admin">Admins</option>
          <option value="user">Users</option>
        </select>
        <select value={filters.status} onChange={setFilter("status")} className="field-input sm:w-40">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!loading && data.users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  No users found.
                </td>
              </tr>
            )}
            {data.users.map((u) => {
              const isMe = u._id === myId;
              return (
                <tr key={u._id} className={loading ? "opacity-60" : ""}>
                  <td className="px-4 py-3">
                    <Link to={`/admin/users/${u._id}`} className="font-semibold text-slate-800 hover:text-blue-600">
                      {u.name}
                    </Link>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-4 py-3"><StatusBadge disabled={u.accountDisabled} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {isMe ? (
                        <span className="text-xs text-slate-400">You</span>
                      ) : (
                        <>
                          <select
                            value={u.role}
                            onChange={(e) => changeRole(u, e.target.value)}
                            aria-label={`Role for ${u.email}`}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                          <button type="button" onClick={() => toggleStatus(u)} className="secondary-button">
                            {u.accountDisabled ? "Enable" : "Disable"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>Page {page} of {data.pagination.pages}</span>
        <div className="flex gap-2">
          <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => { setLoading(true); setPage((p) => p - 1); }}>
            Previous
          </button>
          <button type="button" className="secondary-button" disabled={page >= data.pagination.pages} onClick={() => { setLoading(true); setPage((p) => p + 1); }}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdminUsers;
