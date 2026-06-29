"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";

const STORAGE_KEY = "deccan-temps-v1";

const ROLES = ["Dentist", "RDA", "Assistant", "Front Desk", "Hygienist", "Other"] as const;
type TempRole = typeof ROLES[number];

const SKILLS = ["Dentist", "RDA", "Assistant", "Front Desk", "Hygienist", "X-Ray", "Billing", "Scheduling", "Other"];

const ROLE_COLORS: Record<TempRole, string> = {
  Dentist: "#2563eb",
  RDA: "#dc2626",
  Assistant: "#db2777",
  "Front Desk": "#0284c7",
  Hygienist: "#059669",
  Other: "#6b7280",
};

export interface TempStaff {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: TempRole;
  skills: string[];
  rating: number;
  notes: string;
  addedAt: string;
}

function loadTemps(): TempStaff[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); }
  catch { return []; }
}

function saveTemps(temps: TempStaff[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(temps));
}

function StarRating({ value, onChange, readonly }: { value: number; onChange?: (v: number) => void; readonly?: boolean }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHovered(star)}
          onMouseLeave={() => !readonly && setHovered(0)}
          className={`text-2xl transition ${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"}`}
          style={{ color: star <= (hovered || value) ? "#f59e0b" : "#d1d5db", lineHeight: 1 }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const EMPTY_FORM = {
  name: "", phone: "", email: "", role: "Assistant" as TempRole,
  skills: [] as string[], rating: 0, notes: "",
};

export default function TempsPage() {
  const [temps, setTemps] = useState<TempStaff[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [filterRole, setFilterRole] = useState("");
  const [filterRating, setFilterRating] = useState(0);
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { setTemps(loadTemps()); }, []);

  function refresh() { setTemps(loadTemps()); }

  function handleSkillToggle(skill: string) {
    setForm((f) => ({
      ...f,
      skills: f.skills.includes(skill) ? f.skills.filter((s) => s !== skill) : [...f.skills, skill],
    }));
  }

  function handleSave() {
    if (!form.name.trim()) return;
    const all = loadTemps();
    if (editId) {
      const updated = all.map((t) => t.id === editId ? { ...t, ...form } : t);
      saveTemps(updated);
    } else {
      const newTemp: TempStaff = {
        ...form,
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        addedAt: new Date().toISOString(),
      };
      saveTemps([...all, newTemp]);
    }
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setShowForm(false);
    refresh();
  }

  function handleEdit(temp: TempStaff) {
    setForm({ name: temp.name, phone: temp.phone, email: temp.email, role: temp.role, skills: temp.skills, rating: temp.rating, notes: temp.notes });
    setEditId(temp.id);
    setShowForm(true);
    setExpandedId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleDelete(id: string) {
    saveTemps(loadTemps().filter((t) => t.id !== id));
    setDeleteConfirm(null);
    refresh();
  }

  function handleCancel() {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setShowForm(false);
  }

  const filtered = temps.filter((t) => {
    if (filterRole && t.role !== filterRole) return false;
    if (filterRating && t.rating < filterRating) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.skills.join(" ").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));

  const roleCounts = ROLES.reduce((acc, r) => {
    acc[r] = temps.filter((t) => t.role === r).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen" style={{ background: "#f5f5f5" }}>

      {/* Mobile header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-white shadow-sm sticky top-0 z-50">
        <div>
          <div style={{ fontWeight: 700, color: "#5a5a5a", fontSize: 16 }}>deccan<span style={{ color: "#e8622a" }}>|</span>dental</div>
          <div style={{ fontSize: 10, color: "#9a9a9a", letterSpacing: "0.1em" }}>TEMP STAFF</div>
        </div>
        <button onClick={() => setMenuOpen(!menuOpen)} style={{ fontSize: 22, color: "#5a5a5a" }}>☰</button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black bg-opacity-40" onClick={() => setMenuOpen(false)}>
          <div className="bg-white w-64 h-full p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6">
              <div style={{ fontWeight: 700, fontSize: 18, color: "#5a5a5a" }}>deccan<span style={{ color: "#e8622a" }}>|</span>dental</div>
              <div style={{ fontSize: 11, color: "#9a9a9a" }}>Sleep Center</div>
            </div>
            {[
              { label: "📅 Calendar", href: "/" },
              { label: "✏️ Schedule Builder", href: "/schedule-builder" },
              { label: "🏥 Availability", href: "/availability" },
              { label: "👥 Staff", href: "/staff" },
              { label: "📝 Leave Request", href: "/leave" },
              { label: "🔐 Manage Leave", href: "/leave/manage" },
              { label: "🏖️ Holidays & Closures", href: "/holidays" },
              { label: "🔄 Temp Staff", href: "/temps" },
            ].map((item) => (
              <a key={item.href} href={item.href} className="block rounded-xl px-4 py-3 text-sm font-medium mb-1"
                style={{ color: item.href === "/temps" ? "white" : "#6b7280", backgroundColor: item.href === "/temps" ? "#e8622a" : "transparent" }}>
                {item.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="hidden lg:block"><Sidebar /></div>

      <div className="lg:ml-64 p-4 lg:p-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold" style={{ color: "#5a5a5a" }}>Temp Staff</h1>
            <p className="mt-1 text-gray-400 text-sm">{temps.length} temp{temps.length !== 1 ? "s" : ""} in your roster</p>
          </div>
          {!showForm && (
            <button onClick={() => setShowForm(true)} className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition flex items-center gap-2" style={{ backgroundColor: "#e8622a" }}>
              <span className="text-lg leading-none">+</span> Add Temp
            </button>
          )}
        </div>

        {/* Role summary pills */}
        {temps.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {ROLES.filter((r) => roleCounts[r] > 0).map((r) => (
              <span key={r} className="rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: ROLE_COLORS[r] }}>
                {r} · {roleCounts[r]}
              </span>
            ))}
          </div>
        )}

        {/* Add / Edit Form */}
        {showForm && (
          <div className="rounded-2xl bg-white p-5 lg:p-8 shadow mb-8 max-w-2xl">
            <h2 className="text-lg font-bold mb-5" style={{ color: "#5a5a5a" }}>
              {editId ? "Edit Temp" : "Add New Temp"}
            </h2>

            <div className="space-y-4">

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Full Name <span className="text-red-400">*</span></label>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Jane Smith" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none" style={{ fontSize: 16 }} />
              </div>

              {/* Contact */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Phone Number</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="(555) 555-5555" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none" style={{ fontSize: 16 }} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Email Address</label>
                  <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="jane@example.com" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none" style={{ fontSize: 16 }} />
                </div>
              </div>

              {/* Primary Role */}
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">Primary Role</label>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((r) => (
                    <button key={r} type="button" onClick={() => setForm((f) => ({ ...f, role: r }))}
                      className="rounded-xl border px-4 py-2 text-sm font-medium transition"
                      style={form.role === r ? { backgroundColor: ROLE_COLORS[r], borderColor: ROLE_COLORS[r], color: "white" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Skills */}
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">Skills / Can Also Cover</label>
                <div className="flex flex-wrap gap-2">
                  {SKILLS.map((s) => (
                    <button key={s} type="button" onClick={() => handleSkillToggle(s)}
                      className="rounded-xl border px-3 py-1.5 text-sm font-medium transition"
                      style={form.skills.includes(s) ? { backgroundColor: "#e8622a", borderColor: "#e8622a", color: "white" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rating */}
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">Rating</label>
                <StarRating value={form.rating} onChange={(v) => setForm((f) => ({ ...f, rating: v }))} />
                {form.rating > 0 && (
                  <button type="button" onClick={() => setForm((f) => ({ ...f, rating: 0 }))} className="mt-1 text-xs text-gray-400 hover:text-gray-600">Clear rating</button>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3} placeholder="e.g. Very reliable, prefers morning shifts, has own equipment..."
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none resize-none" style={{ fontSize: 16 }} />
              </div>

              {!form.name.trim() && (
                <p className="text-xs text-red-400">Name is required.</p>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={handleSave} disabled={!form.name.trim()}
                  className="flex-1 rounded-xl py-3 font-semibold text-white hover:opacity-90 transition disabled:opacity-40" style={{ backgroundColor: "#e8622a" }}>
                  {editId ? "Save Changes" : "Add to Roster"}
                </button>
                <button onClick={handleCancel} className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        {temps.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-5">
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Search by name or skill..." className="rounded-xl border border-gray-200 px-4 py-2 text-sm focus:outline-none bg-white shadow flex-1 min-w-[180px]" style={{ fontSize: 16 }} />
            <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none bg-white shadow" style={{ fontSize: 16 }}>
              <option value="">All Roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={filterRating} onChange={(e) => setFilterRating(Number(e.target.value))}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none bg-white shadow" style={{ fontSize: 16 }}>
              <option value={0}>All Ratings</option>
              <option value={5}>★★★★★ only</option>
              <option value={4}>★★★★+ </option>
              <option value={3}>★★★+</option>
            </select>
          </div>
        )}

        {/* Temp Cards */}
        {temps.length === 0 ? (
          <div className="rounded-2xl bg-white p-12 text-center shadow">
            <div className="text-5xl mb-4">🔄</div>
            <h2 className="text-xl font-bold mb-2" style={{ color: "#5a5a5a" }}>No Temp Staff Yet</h2>
            <p className="text-gray-400 text-sm mb-6">Add temps to your roster so you can quickly fill shifts when needed.</p>
            <button onClick={() => setShowForm(true)} className="rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>
              + Add Your First Temp
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow">
            <p className="text-gray-400">No temps match your filters.</p>
            <button onClick={() => { setSearch(""); setFilterRole(""); setFilterRating(0); }} className="mt-3 text-sm text-orange-500 hover:underline">Clear filters</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((temp) => {
              const roleColor = ROLE_COLORS[temp.role];
              const isExpanded = expandedId === temp.id;
              return (
                <div key={temp.id} className="rounded-2xl bg-white shadow overflow-hidden">
                  {/* Color bar */}
                  <div style={{ height: 4, backgroundColor: roleColor }} />

                  <div className="p-5">
                    {/* Top row */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                          style={{ backgroundColor: roleColor }}>
                          {temp.name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-base" style={{ color: "#5a5a5a" }}>{temp.name}</div>
                          <span className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold text-white mt-0.5" style={{ backgroundColor: roleColor }}>
                            {temp.role}
                          </span>
                        </div>
                      </div>
                      <StarRating value={temp.rating} readonly />
                    </div>

                    {/* Contact */}
                    <div className="space-y-1 mb-3">
                      {temp.phone && (
                        <a href={`tel:${temp.phone}`} className="flex items-center gap-2 text-sm text-gray-500 hover:text-orange-500 transition">
                          <span>📞</span> {temp.phone}
                        </a>
                      )}
                      {temp.email && (
                        <a href={`mailto:${temp.email}`} className="flex items-center gap-2 text-sm text-gray-500 hover:text-orange-500 transition truncate">
                          <span>✉️</span> {temp.email}
                        </a>
                      )}
                    </div>

                    {/* Skills */}
                    {temp.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {temp.skills.map((s) => (
                          <span key={s} className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-xs font-medium">{s}</span>
                        ))}
                      </div>
                    )}

                    {/* Notes — expandable */}
                    {temp.notes && (
                      <div className="mb-3">
                        <p className={`text-sm text-gray-400 italic ${isExpanded ? "" : "line-clamp-2"}`}>"{temp.notes}"</p>
                        {temp.notes.length > 80 && (
                          <button onClick={() => setExpandedId(isExpanded ? null : temp.id)} className="text-xs text-orange-400 hover:text-orange-600 mt-0.5">
                            {isExpanded ? "Show less" : "Show more"}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-2 border-t border-gray-100 mt-2">
                      <button onClick={() => handleEdit(temp)} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 transition">
                        ✏️ Edit
                      </button>
                      {deleteConfirm === temp.id ? (
                        <div className="flex gap-1 flex-1">
                          <button onClick={() => handleDelete(temp.id)} className="flex-1 rounded-xl bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-600 transition">
                            Confirm
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-medium text-gray-400 hover:bg-gray-50 transition">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirm(temp.id)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-red-400 hover:bg-red-50 hover:border-red-200 transition">
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
