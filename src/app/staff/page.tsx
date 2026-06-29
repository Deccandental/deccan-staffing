"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Employee, EmployeeRole, DentistSpecialty } from "@/types/employee";
import {
  loadStaff, addEmployee, updateEmployee, removeEmployee,
  loadPrefs, setDentistPrefs, DentistPrefs,
} from "@/lib/staffStore";

const ROLES: EmployeeRole[] = ["Dentist", "RDA", "Assistant", "Front Desk", "Hygienist"];

const SPECIALTIES: DentistSpecialty[] = [
  "General Dentist", "Prosthodontist", "Periodontist", "Endodontist"
];

const ALL_SKILLS = ["Dentist", "RDA", "Assistant", "Front Desk", "Hygienist"];
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const COLORS = ["#2563eb","#7c3aed","#ea580c","#16a34a","#0284c7","#0891b2","#dc2626","#db2777","#9333ea","#059669","#d97706","#0f766e"];

const EMPTY_EMP: Omit<Employee, "id"> = {
  name: "",
  role: "Assistant",
  color: "#2563eb",
  skills: ["Assistant"],
  defaultSchedule: { monday: true, tuesday: false, wednesday: true, thursday: true, friday: true },
};

const ROLE_COLORS: Record<string, string> = {
  Dentist: "bg-blue-100 text-blue-700",
  RDA: "bg-purple-100 text-purple-700",
  Assistant: "bg-pink-100 text-pink-700",
  "Front Desk": "bg-sky-100 text-sky-700",
  Hygienist: "bg-emerald-100 text-emerald-700",
};

export default function StaffPage() {
  const [staff, setStaff] = useState<Employee[]>([]);
  const [prefs, setPrefs] = useState<DentistPrefs>({});
  const [editing, setEditing] = useState<Employee | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Omit<Employee, "id">>(EMPTY_EMP);
  const [activeTab, setActiveTab] = useState<"staff" | "prefs">("staff");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  useEffect(() => { refresh(); }, []);

  function refresh() { setStaff(loadStaff()); setPrefs(loadPrefs()); }

  function handleSave() {
    if (!form.name.trim()) return;
    if (editing) { updateEmployee({ ...form, id: editing.id }); }
    else { addEmployee(form); }
    setEditing(null);
    setAdding(false);
    setForm(EMPTY_EMP);
    refresh();
  }

  function handleEdit(emp: Employee) {
    setEditing(emp);
    setAdding(false);
    setForm({ name: emp.name, role: emp.role, specialty: emp.specialty, color: emp.color, skills: emp.skills, defaultSchedule: { ...emp.defaultSchedule }, email: emp.email ?? "" });
  }

  function handleDelete(id: number) {
    removeEmployee(id);
    setConfirmDelete(null);
    refresh();
  }

  function toggleSkill(skill: string) {
    setForm((f) => ({
      ...f,
      skills: f.skills.includes(skill) ? f.skills.filter((s) => s !== skill) : [...f.skills, skill],
    }));
  }

  function toggleDay(day: typeof DAYS[number]) {
    setForm((f) => ({ ...f, defaultSchedule: { ...f.defaultSchedule, [day]: !f.defaultSchedule[day] } }));
  }

  function movePref(dentistId: number, assistantId: number, dir: -1 | 1) {
    const current = prefs[dentistId] ?? [];
    const idx = current.indexOf(assistantId);
    if (idx === -1) return;
    const next = [...current];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setDentistPrefs(dentistId, next);
    refresh();
  }

  function initPrefs(dentistId: number) {
    const assistants = staff.filter((e) => e.skills.includes("Assistant") || e.skills.includes("RDA"));
    const current = prefs[dentistId] ?? [];
    const missing = assistants.filter((a) => !current.includes(a.id)).map((a) => a.id);
    const full = [...current.filter((id) => staff.find((e) => e.id === id)), ...missing];
    setDentistPrefs(dentistId, full);
    refresh();
  }

  const dentists = staff.filter((e) => e.role === "Dentist");
  const assistants = staff.filter((e) => e.skills.includes("Assistant") || e.skills.includes("RDA"));

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#5a5a5a" }}>Staff Management</h1>
            <p className="mt-1 text-gray-400">{staff.length} team members</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setActiveTab("staff")} className="rounded-xl px-4 py-2 text-sm font-semibold transition" style={activeTab === "staff" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>Staff Directory</button>
            <button onClick={() => setActiveTab("prefs")} className="rounded-xl px-4 py-2 text-sm font-semibold transition" style={activeTab === "prefs" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>Dentist Preferences</button>
          </div>
        </div>

        {activeTab === "staff" && (
          <div className="space-y-4">
            {!adding && !editing && (
              <button onClick={() => { setAdding(true); setEditing(null); setForm(EMPTY_EMP); }} className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                + Add Employee
              </button>
            )}

            {(adding || editing) && (
              <div className="rounded-2xl bg-white p-6 shadow space-y-5">
                <h2 className="text-xl font-bold" style={{ color: "#5a5a5a" }}>{editing ? "Edit Employee" : "Add Employee"}</h2>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Name</label>
                    <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none" placeholder="Full name" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Email Address</label>
                    <input type="email" value={(form as any).email ?? ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none" placeholder="staff@mydeccandental.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Primary Role</label>
                    <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as EmployeeRole, specialty: undefined }))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none">
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                </div>

                {/* Specialty — only for Dentists */}
                {form.role === "Dentist" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Specialty</label>
                    <select value={form.specialty ?? "General Dentist"} onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value as DentistSpecialty }))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none">
                      {SPECIALTIES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">Skills <span className="text-gray-300">(check all that apply)</span></label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_SKILLS.map((s) => (
                      <button key={s} onClick={() => toggleSkill(s)} className="rounded-full border px-3 py-1 text-xs font-medium transition" style={form.skills.includes(s) ? { backgroundColor: "#e8622a", borderColor: "#e8622a", color: "white" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>{s}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">Default Schedule</label>
                  <div className="flex gap-2">
                    {DAYS.map((day, i) => (
                      <button key={day} onClick={() => toggleDay(day)} disabled={day === "tuesday"} className="flex-1 rounded-lg py-2 text-xs font-semibold transition" style={form.defaultSchedule[day] ? { backgroundColor: "#e8622a", color: "white" } : { background: "#f1f5f9", color: "#9ca3af" }}>
                        {DAY_LABELS[i]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => (
                      <button key={c} onClick={() => setForm((f) => ({ ...f, color: c }))} className="h-8 w-8 rounded-full transition" style={{ backgroundColor: c, outline: form.color === c ? `3px solid ${c}` : "none", outlineOffset: "2px" }} />
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={handleSave} className="rounded-xl px-5 py-2 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>{editing ? "Save Changes" : "Add Employee"}</button>
                  <button onClick={() => { setEditing(null); setAdding(false); }} className="rounded-xl border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition">Cancel</button>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {staff.map((emp) => (
                <div key={emp.id} className="rounded-2xl bg-white p-5 shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: emp.color }}>{emp.name.charAt(0)}</div>
                      <div>
                        <div className="font-semibold" style={{ color: "#5a5a5a" }}>{emp.name}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {emp.role === "Dentist" ? (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[emp.role]}`}>
                              {emp.specialty ?? "Dentist"}
                            </span>
                          ) : (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[emp.role] ?? "bg-slate-100 text-slate-600"}`}>{emp.role}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => handleEdit(emp)} className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition">Edit</button>
                      {confirmDelete === emp.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleDelete(emp.id)} className="rounded-lg px-2 py-1 text-xs bg-red-100 text-red-600 hover:bg-red-200 transition">Confirm</button>
                          <button onClick={() => setConfirmDelete(null)} className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 transition">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(emp.id)} className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-500 transition">Remove</button>
                      )}
                    </div>
                  </div>

                  {emp.skills.length > 1 && (
                    <div className="mb-3 flex flex-wrap gap-1">
                      {emp.skills.map((s) => <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{s}</span>)}
                    </div>
                  )}

                  <div className="flex gap-1">
                    {DAYS.map((day, i) => {
                      const works = emp.defaultSchedule[day];
                      const isTue = day === "tuesday";
                      return (
                        <div key={day} className="flex-1 rounded py-1 text-center text-xs font-semibold" style={isTue ? { background: "#f1f5f9", color: "#cbd5e1" } : works ? { backgroundColor: emp.color, color: "white" } : { background: "#f1f5f9", color: "#cbd5e1" }}>
                          {DAY_LABELS[i]}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "prefs" && (
          <div className="space-y-6">
            <p className="text-gray-400 text-sm">Set the preferred assistant/RDA order for each dentist. Use ↑↓ to reorder.</p>
            {dentists.map((dentist) => {
              const prefIds = prefs[dentist.id];
              if (!prefIds) {
                return (
                  <div key={dentist.id} className="rounded-2xl bg-white p-6 shadow">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: dentist.color }}>{dentist.name.charAt(0)}</div>
                        <div>
                          <span className="font-semibold" style={{ color: "#5a5a5a" }}>{dentist.name}</span>
                          {dentist.specialty && <span className="ml-2 text-xs text-gray-400">{dentist.specialty}</span>}
                        </div>
                      </div>
                      <button onClick={() => initPrefs(dentist.id)} className="rounded-lg px-3 py-1.5 text-sm font-medium transition" style={{ backgroundColor: "#fff0eb", color: "#e8622a" }}>Set Preferences</button>
                    </div>
                    <p className="text-sm text-gray-400">No preferences set — click to configure.</p>
                  </div>
                );
              }

              const orderedAssistants = prefIds.map((id) => assistants.find((a) => a.id === id)).filter(Boolean) as Employee[];

              return (
                <div key={dentist.id} className="rounded-2xl bg-white p-6 shadow">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="h-9 w-9 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: dentist.color }}>{dentist.name.charAt(0)}</div>
                    <div>
                      <span className="font-semibold" style={{ color: "#5a5a5a" }}>{dentist.name}</span>
                      {dentist.specialty && <span className="ml-2 text-xs text-gray-400">{dentist.specialty}</span>}
                    </div>
                    <span className="text-xs text-gray-300 ml-1">— Assistant/RDA priority order</span>
                  </div>
                  <div className="space-y-2">
                    {orderedAssistants.map((asst, idx) => (
                      <div key={asst.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                        <span className="w-6 text-center text-sm font-bold text-gray-300">{idx + 1}</span>
                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: asst.color }} />
                        <span className="flex-1 text-sm font-medium" style={{ color: "#5a5a5a" }}>{asst.name}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full mr-2 ${ROLE_COLORS[asst.role] ?? "bg-gray-100 text-gray-500"}`}>{asst.role}</span>
                        <div className="flex gap-1">
                          <button onClick={() => movePref(dentist.id, asst.id, -1)} disabled={idx === 0} className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-200 disabled:opacity-30 transition">↑</button>
                          <button onClick={() => movePref(dentist.id, asst.id, 1)} disabled={idx === orderedAssistants.length - 1} className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-200 disabled:opacity-30 transition">↓</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
