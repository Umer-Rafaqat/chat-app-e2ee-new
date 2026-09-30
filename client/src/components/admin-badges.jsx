export function RoleBadge({ role }) {
  const admin = role === "admin";
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        admin ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      {role}
    </span>
  );
}

export function StatusBadge({ disabled }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        disabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
      }`}
    >
      {disabled ? "disabled" : "active"}
    </span>
  );
}
