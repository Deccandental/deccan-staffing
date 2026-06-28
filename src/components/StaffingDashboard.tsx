const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const roles = ["Dentists", "Front Desk", "Assistants", "Hygienist"];

export function StaffingDashboard() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-700">
            Weekly Staffing Dashboard
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Daily coverage overview
          </h1>
        </div>
        <div className="rounded-full bg-cyan-50 px-3 py-1 text-sm font-medium text-cyan-700">
          Updated today
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-5 lg:grid-cols-2">
        {days.map((day) => (
          <section
            key={day}
            className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 shadow-[0_8px_25px_rgba(15,23,42,0.04)]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{day}</h2>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500">
                Open
              </span>
            </div>

            <div className="space-y-3">
              {roles.map((role) => (
                <div key={role} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-700">{role}</p>
                    <button
                      type="button"
                      aria-label={`Add ${role} for ${day}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-lg font-semibold text-slate-500 transition hover:border-cyan-300 hover:text-cyan-700"
                    >
                      +
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">No staff assigned</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
