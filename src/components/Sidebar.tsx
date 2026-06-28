const navItems = [
  { label: "Dashboard", active: true },
  { label: "Staff" },
  { label: "Schedule" },
  { label: "PTO" },
  { label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 flex w-64 flex-col border-r border-slate-200 bg-slate-100/90 px-5 py-6">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-700">
          Operations
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          Deccan Staffing
        </h2>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => (
          <a
            key={item.label}
            href="#"
            aria-current={item.active ? "page" : undefined}
            className={`flex items-center rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              item.active
                ? "bg-cyan-700 text-white shadow-sm"
                : "text-slate-600 hover:bg-white hover:text-slate-900"
            }`}
          >
            <span className="mr-3 h-2.5 w-2.5 rounded-full bg-current" />
            {item.label}
          </a>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Coverage status</p>
        <p className="mt-1 text-sm text-slate-500">
          Daily scheduling is ready for review.
        </p>
      </div>
    </aside>
  );
}
