import { useEffect, useState } from "react";
import { api } from "../../services/api";

const CARDS = [
  { key: "totalUsers", label: "Total users" },
  { key: "onlineUsers", label: "Online now" },
  { key: "groups", label: "Groups" },
  { key: "messages", label: "Messages" },
  { key: "admins", label: "Admins" },
  { key: "newUsersThisWeek", label: "New this week" },
  { key: "disabledUsers", label: "Disabled accounts" },
];

function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getAdminStats().then(setStats).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Dashboard</h2>
      <p className="mt-1 text-sm text-slate-500">Overview of your chat workspace.</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {CARDS.map(({ key, label }) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {stats ? stats[key] : "–"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AdminDashboard;
