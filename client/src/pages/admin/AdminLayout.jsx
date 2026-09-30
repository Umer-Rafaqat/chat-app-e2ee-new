import { NavLink, Outlet, Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/groups", label: "Groups" },
];

const navClass = ({ isActive }) =>
  `whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition ${
    isActive
      ? "bg-blue-50 text-blue-700"
      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
  }`;

function AdminLayout() {
  const { user } = useAuth();

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:min-h-dvh md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-4 md:block md:px-5 md:py-5">
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900">
              Admin Panel
            </h1>
            <p className="text-xs text-slate-500">{user?.name}</p>
          </div>
          <Link
            to="/chat"
            className="secondary-button md:mt-4 md:block md:text-center"
          >
            ← Back to chat
          </Link>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}

export default AdminLayout;
