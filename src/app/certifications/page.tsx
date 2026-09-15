"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import {
  Certification, NewCertInput, CertOwnerType,
  loadAllCertifications, loadCertificationsForEmployee,
  createCertification, updateCertification, deleteCertification, uploadCertFile,
} from "@/lib/certsStore";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import { RequiredCertsSection, getApplicableRoles } from "@/components/RequiredCertsSection";
import {
  RequiredCertType, RequiredCertRole, RequiredCertStatus, CeCourseEntry,
  loadRequiredCertTypes, createRequiredCertType, renameRequiredCertType, updateRequiredCertType, deleteRequiredCertType,
  loadAllCeCourseEntries, loadCeCourseEntriesForEmployee, addCeCourseEntry, deleteCeCourseEntry, computeRequiredCertStatuses, addMonths,
} from "@/lib/requiredCertsStore";

interface FormState {
  ownerType: CertOwnerType;
  employeeId: string;
  title: string;
  expirationDate: string; // empty string = no expiration
  ceHours: string; // empty string = no CE credit entered
}

const EMPTY_FORM: FormState = {
  ownerType: "personnel",
  employeeId: "",
  title: "",
  expirationDate: "",
  ceHours: "",
};

// Which required-cert roles apply to this employee — a specialty dentist
// gets both "Dentist" and "Specialist" (for the extra board certificate).
function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

function statusBadge(cert: Certification): { label: string; className: string } {
  if (!cert.expirationDate) return { label: "No expiration", className: "bg-slate-100 text-slate-500" };
  const days = daysUntil(cert.expirationDate);
  if (days < 0) return { label: "Expired", className: "bg-red-100 text-red-700" };
  if (days <= 7) return { label: `Expires in ${days}d`, className: "bg-red-100 text-red-700" };
  if (days <= 30) return { label: `Expires in ${days}d`, className: "bg-amber-100 text-amber-700" };
  if (days <= 60) return { label: `Expires in ${days}d`, className: "bg-yellow-100 text-yellow-700" };
  return { label: "Current", className: "bg-green-100 text-green-700" };
}

function CertForm({
  form, setForm, file, setFile, error, saving, staff, lockOwner, editingId, onSave, onCancel,
  titleOptions, useCustomTitle, setUseCustomTitle, requiredTypes,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  file: File | null;
  setFile: (f: File | null) => void;
  error: string;
  saving: boolean;
  staff: Employee[];
  lockOwner: boolean;
  editingId: string | null;
  onSave: () => void;
  onCancel: () => void;
  titleOptions: string[];
  useCustomTitle: boolean;
  setUseCustomTitle: (v: boolean) => void;
  requiredTypes: RequiredCertType[];
}) {
  const matchingType = requiredTypes.find((t) => t.title === form.title);
  const isCompletionMode = matchingType?.kind !== "ce_hours" && matchingType?.dateMode === "completion";
  const isNeverExpires = matchingType?.kind !== "ce_hours" && matchingType?.dateMode === "none";

  return (
    <div className="rounded-2xl bg-white p-6 shadow max-w-2xl">
      <h2 className="text-lg font-bold mb-4">
        {editingId ? "Edit" : form.ownerType === "business" ? "Add Business License" : "Add Certification"}
      </h2>
      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {!lockOwner && !editingId && (
        <div className="mb-4 flex gap-2">
          <button type="button" onClick={() => setForm((f) => ({ ...f, ownerType: "personnel" }))}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition"
            style={form.ownerType === "personnel" ? { backgroundColor: "#e8622a", color: "white" } : { background: "#f1f5f9", color: "#6b7280" }}>
            Personnel
          </button>
          <button type="button" onClick={() => setForm((f) => ({ ...f, ownerType: "business" }))}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition"
            style={form.ownerType === "business" ? { backgroundColor: "#e8622a", color: "white" } : { background: "#f1f5f9", color: "#6b7280" }}>
            Business License
          </button>
        </div>
      )}

      {form.ownerType === "personnel" && !lockOwner && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Staff Member</label>
          <select value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none">
            <option value="">Select staff member...</option>
            {staff.filter((e) => !e.archived).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      )}

      <div className="mb-4">
        <label className="block text-xs font-semibold text-slate-500 mb-1">Document Name</label>
        {!useCustomTitle ? (
          <select
            value={titleOptions.includes(form.title) ? form.title : ""}
            onChange={(e) => {
              if (e.target.value === "__new__") {
                setUseCustomTitle(true);
                setForm((f) => ({ ...f, title: "" }));
              } else {
                setForm((f) => ({ ...f, title: e.target.value }));
              }
            }}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none">
            <option value="">Select a document name...</option>
            {titleOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value="__new__">+ Add new document name...</option>
          </select>
        ) : (
          <div className="flex gap-2">
            <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. CPR Certification, State Dental License, Business Operating License"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
            {titleOptions.length > 0 && (
              <button type="button" onClick={() => { setUseCustomTitle(false); setForm((f) => ({ ...f, title: "" })); }}
                className="flex-shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                Choose existing
              </button>
            )}
          </div>
        )}
      </div>

      {isNeverExpires ? (
        <p className="text-xs mb-4" style={{ color: "rgba(74,66,56,0.5)" }}>This certificate never expires — no date needed, just the file.</p>
      ) : (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            {isCompletionMode
              ? "Completion Date (expiration will be calculated automatically)"
              : "Expiration Date (optional — leave blank if this never expires)"}
          </label>
          <input type="date" value={form.expirationDate} onChange={(e) => setForm((f) => ({ ...f, expirationDate: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          {isCompletionMode && form.expirationDate && matchingType && (
            <p className="text-xs text-slate-400 mt-1">→ Expires {new Date(addMonths(form.expirationDate, matchingType.frequencyMonths) + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
          )}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-xs font-semibold text-slate-500 mb-1">CE Credits Earned (optional — counts toward the overall CE hours total)</label>
        <input type="number" onFocus={(e) => e.target.select()} value={form.ceHours} onChange={(e) => setForm((f) => ({ ...f, ceHours: e.target.value }))}
          placeholder="e.g. 4" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
      </div>

      <div className="mb-5">
        <label className="block text-xs font-semibold text-slate-500 mb-1">
          Certificate File {editingId ? "(optional — leave blank to keep existing file)" : ""}
        </label>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
      </div>

      <div className="flex gap-3">
        <button onClick={onSave} disabled={saving}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50"
          style={{ backgroundColor: "#e8622a" }}>
          {saving ? "Saving…" : editingId ? "Save Changes" : "Upload"}
        </button>
        <button onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ManageRequiredTypesPanel({ requiredTypes, refreshAll }: { requiredTypes: RequiredCertType[]; refreshAll: () => void }) {
  const [newTitle, setNewTitle] = useState("");
  const [newRole, setNewRole] = useState<RequiredCertRole>("Dentist");
  const [newKind, setNewKind] = useState<"license" | "ce_hours" | "standalone" | "one_time_ce" | "total_ce_hours">("standalone");
  const [newDateMode, setNewDateMode] = useState<"expiration" | "completion" | "none">("completion");
  const [newFrequency, setNewFrequency] = useState("24");
  const [newTargetHours, setNewTargetHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function handleAdd() {
    if (!newTitle.trim()) return;
    const result = await createRequiredCertType({
      title: newTitle.trim(), appliesToRole: newRole, kind: newKind,
      frequencyMonths: Number(newFrequency) || 24, sortOrder: requiredTypes.filter((t) => t.appliesToRole === newRole).length + 1,
      dateMode: newDateMode, targetHours: newTargetHours ? Number(newTargetHours) : null,
    });
    if (!result.ok) { setError(result.error ?? "Failed to add."); return; }
    setError(null);
    setNewTitle("");
    setNewTargetHours("");
    await refreshAll();
  }

  async function handleRename(type: RequiredCertType) {
    if (!renameValue.trim() || renameValue.trim() === type.title) { setRenamingId(null); return; }
    const result = await renameRequiredCertType(type.id, type.title, renameValue.trim());
    if (!result.ok) { setError(result.error ?? "Failed to rename."); return; }
    setError(null);
    setRenamingId(null);
    await refreshAll();
  }

  async function handleToggleDateMode(type: RequiredCertType) {
    const cycle: Record<string, "expiration" | "completion" | "none"> = { expiration: "completion", completion: "none", none: "expiration" };
    const newMode = cycle[type.dateMode] ?? "expiration";
    await updateRequiredCertType(type.id, { dateMode: newMode });
    await refreshAll();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this required type? This won't delete any existing certifications or CE entries, but staff will stop being tracked against it.")) return;
    await deleteRequiredCertType(id);
    await refreshAll();
  }

  const roles: RequiredCertRole[] = ["Dentist", "RDA", "Hygienist", "Specialist", "Assistant"];

  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <h3 className="font-bold text-slate-700 mb-3">Manage Required Certificate Types</h3>
      <div className="grid gap-2 sm:grid-cols-7 mb-3">
        <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none sm:col-span-2" />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value as RequiredCertRole)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as any)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
          <option value="license">License (expiration date)</option>
          <option value="standalone">Standalone cert</option>
          <option value="ce_hours">CE hours (logged courses)</option>
          <option value="one_time_ce">One-time CE (never expires)</option>
          <option value="total_ce_hours">Total CE hours (running tally)</option>
        </select>
        {(newKind === "license" || newKind === "standalone") && (
          <select value={newDateMode} onChange={(e) => setNewDateMode(e.target.value as any)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
            <option value="expiration">Enter expiration date</option>
            <option value="completion">Enter completion date (auto-computes expiration)</option>
            <option value="none">Never expires — no date needed</option>
          </select>
        )}
        {(newKind === "one_time_ce" || newKind === "total_ce_hours") && (
          <input type="number" value={newTargetHours} onChange={(e) => setNewTargetHours(e.target.value)} placeholder="Target hrs" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
        )}
        <input type="number" value={newFrequency} onChange={(e) => setNewFrequency(e.target.value)} placeholder="Months" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
      </div>
      <button onClick={handleAdd} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition mb-4" style={{ backgroundColor: "#e8622a" }}>+ Add Required Type</button>
      {error && <p className="text-sm text-red-600 mb-3">⚠️ {error}</p>}

      <div className="space-y-1">
        {requiredTypes.map((type) => (
          <div key={type.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
            {renamingId === type.id ? (
              <div className="flex items-center gap-2 flex-1">
                <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none flex-1" autoFocus />
                <button onClick={() => handleRename(type)} className="text-xs font-semibold text-emerald-600 hover:underline">Save</button>
                <button onClick={() => setRenamingId(null)} className="text-xs text-slate-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <>
                <span className="text-slate-700">
                  <strong>{type.title}</strong>
                  <span className="text-xs text-slate-400 ml-2">
                    {type.appliesToRole} · {
                      type.kind === "ce_hours" ? "CE hours" :
                      type.kind === "license" ? "License" :
                      type.kind === "one_time_ce" ? `One-time CE (${type.targetHours ?? "?"} hrs)` :
                      type.kind === "total_ce_hours" ? `Total CE hours (target ${type.targetHours ?? "?"})` :
                      "Standalone"
                    } · every {type.frequencyMonths}mo
                    {(type.kind === "license" || type.kind === "standalone") && ` · ${type.dateMode === "completion" ? "completion date (auto-expires)" : type.dateMode === "none" ? "never expires" : "expiration date"}`}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  {(type.kind === "license" || type.kind === "standalone") && (
                    <button onClick={() => handleToggleDateMode(type)} className="text-xs text-blue-500 hover:underline">
                      Switch to {type.dateMode === "expiration" ? "completion date" : type.dateMode === "completion" ? "never expires" : "expiration date"}
                    </button>
                  )}
                  <button onClick={() => { setRenamingId(type.id); setRenameValue(type.title); }} className="text-xs text-orange-500 hover:underline">Rename</button>
                  <button onClick={() => handleDelete(type.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CertificationsPageBody({ identity, logout }: { identity: AppIdentity; logout: () => void }) {
  const isManager = identity.canManageCerts;
  const [staff, setStaff] = useState<Employee[]>([]);
  const [myCerts, setMyCerts] = useState<Certification[]>([]);
  const [allCerts, setAllCerts] = useState<Certification[]>([]);
  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  const [useCustomTitle, setUseCustomTitle] = useState(false);
  const [view, setView] = useState<"mine" | "all">("mine");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState<Record<string, string>>({});
  const [requiredTypes, setRequiredTypes] = useState<RequiredCertType[]>([]);
  const [allCeEntries, setAllCeEntries] = useState<CeCourseEntry[]>([]);
  const [showRequiredOverview, setShowRequiredOverview] = useState(false);
  const [showManageTypes, setShowManageTypes] = useState(false);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const s = await loadStaff();
    setStaff(s);
    if (identity.mode === "staff" && identity.employeeId != null) {
      const mine = await loadCertificationsForEmployee(identity.employeeId);
      setMyCerts(mine);
    }
    if (isManager) {
      const all = await loadAllCertifications();
      setAllCerts(all);
    }
    const types = await loadRequiredCertTypes();
    setRequiredTypes(types);
    // The dropdown offers the standardized required titles only, rather than
    // every distinct title ever typed — this is what makes it easy to rename
    // a mismatched existing entry to the correct standard name.
    const standardTitles = Array.from(new Set(types.map((t) => t.title))).sort((a, b) => a.localeCompare(b));
    setTitleOptions(standardTitles);
    const ce = await loadAllCeCourseEntries();
    setAllCeEntries(ce);
  }

  function openNewForStaffSelf() {
    setForm({ ...EMPTY_FORM, ownerType: "personnel", employeeId: identity.mode === "staff" ? String(identity.employeeId) : "" });
    setEditingId(null);
    setFile(null);
    setError("");
    setUseCustomTitle(titleOptions.length === 0);
    setShowForm(true);
  }

  function openNewManager(ownerType: CertOwnerType) {
    setForm({ ...EMPTY_FORM, ownerType });
    setEditingId(null);
    setFile(null);
    setError("");
    setUseCustomTitle(titleOptions.length === 0);
    setShowForm(true);
  }

  function openForRequiredItem(title: string, employeeId: number, existing?: Certification) {
    if (existing) { startEdit(existing); return; }
    setForm({ ownerType: "personnel", employeeId: String(employeeId), title, expirationDate: "", ceHours: "" });
    setEditingId(null);
    setFile(null);
    setError("");
    setUseCustomTitle(false);
    setShowForm(true);
  }

  function startEdit(cert: Certification) {
    setForm({
      ownerType: cert.ownerType,
      employeeId: cert.employeeId != null ? String(cert.employeeId) : "",
      title: cert.title,
      expirationDate: cert.expirationDate ?? "",
      ceHours: cert.ceHours != null ? String(cert.ceHours) : "",
    });
    setEditingId(cert.id);
    setFile(null);
    setError("");
    setUseCustomTitle(!titleOptions.includes(cert.title));
    setShowForm(true);
  }

  function closeForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFile(null);
    setError("");
    setUseCustomTitle(false);
    setShowForm(false);
  }

  async function handleSave() {
    setError("");
    if (!form.title.trim()) { setError("Please enter a document name."); return; }
    if (form.ownerType === "personnel" && !form.employeeId) { setError("Please select a staff member."); return; }
    if (!editingId && !file) { setError("Please choose a file to upload."); return; }

    setSaving(true);
    let fileUrl = "";
    let fileName = "";
    if (file) {
      const uploaded = await uploadCertFile(file);
      if ("error" in uploaded) { setError(uploaded.error); setSaving(false); return; }
      fileUrl = uploaded.url;
      fileName = uploaded.name;
    } else if (editingId) {
      const existing = (isManager ? allCerts : myCerts).find((c) => c.id === editingId);
      fileUrl = existing?.fileUrl ?? "";
      fileName = existing?.fileName ?? "";
    }

    const matchingType = requiredTypes.find((t) => t.title === form.title.trim());
    const isCompletionMode = matchingType && matchingType.kind !== "ce_hours" && matchingType.dateMode === "completion";
    const isNeverExpires = matchingType && matchingType.kind !== "ce_hours" && matchingType.dateMode === "none";
    const resolvedExpiration = isNeverExpires
      ? null
      : isCompletionMode && form.expirationDate
        ? addMonths(form.expirationDate, matchingType!.frequencyMonths)
        : form.expirationDate || null;

    const input: NewCertInput = {
      ownerType: form.ownerType,
      employeeId: form.ownerType === "personnel" ? Number(form.employeeId) : null,
      title: form.title.trim(),
      expirationDate: resolvedExpiration,
      ceHours: form.ceHours ? Number(form.ceHours) : null,
      fileUrl, fileName,
    };

    const saved = editingId ? await updateCertification(editingId, input) : await createCertification(input);
    if (!saved) {
      setError("Something went wrong saving this — it was not saved. Try again.");
      setSaving(false);
      return;
    }
    setSaving(false);
    closeForm();
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this certification/license? This can't be undone.")) return;
    await deleteCertification(id);
    await refresh();
  }

  async function handleSendNow(id: string) {
    setNotifyMsg((m) => ({ ...m, [id]: "Sending…" }));
    try {
      const res = await fetch("/api/certs/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certId: id }),
      });
      const data = await res.json();
      setNotifyMsg((m) => ({ ...m, [id]: data.sent ? "Reminder sent." : "Could not send." }));
    } catch {
      setNotifyMsg((m) => ({ ...m, [id]: "Something went wrong." }));
    }
  }

  const employeeName = (id: number | null) => staff.find((e) => e.id === id)?.name ?? "Unknown";

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-8 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">Certifications</h1>
            <p className="mt-1 text-slate-500">Personnel certifications and business licenses, with expiry reminders.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-sm text-sm">
            <span className="text-gray-400">
              {isManager ? "👔 Manager view" : `👤 ${identity.employeeName ?? ""}`}
            </span>
            <button onClick={logout} className="text-xs font-semibold text-gray-400 hover:text-red-500 underline">
              Not you?
            </button>
          </div>
        </header>

        {isManager && (
          <div className="flex gap-2 mb-6">
            <button onClick={() => setView("mine")} className="rounded-xl px-4 py-2 text-sm font-semibold transition"
              style={view === "mine" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>
              My Certifications
            </button>
            <button onClick={() => setView("all")} className="rounded-xl px-4 py-2 text-sm font-semibold transition"
              style={view === "all" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>
              All Certifications & Licenses
            </button>
          </div>
        )}

        {(identity.mode === "staff" || view === "mine") && (
          <div className="max-w-2xl space-y-4">
            {identity.mode === "staff" && identity.employeeId != null && (() => {
              const me = staff.find((e) => e.id === identity.employeeId);
              return me ? (
                <RequiredCertsSection
                  employee={me} certs={myCerts} requiredTypes={requiredTypes}
                  ceEntries={allCeEntries.filter((e) => e.employeeId === me.id)}
                  onAddCertForTitle={(title, existing) => openForRequiredItem(title, me.id, existing)}
                  refreshAll={refresh}
                />
              ) : null;
            })()}
            {identity.mode === "staff" && !showForm && (
              <button onClick={openNewForStaffSelf}
                className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow hover:opacity-90 transition"
                style={{ backgroundColor: "#e8622a" }}>
                + Upload Certification
              </button>
            )}
            {showForm && identity.mode === "staff" && (
              <CertForm form={form} setForm={setForm} file={file} setFile={setFile} error={error} saving={saving}
                staff={staff} lockOwner editingId={editingId} onSave={handleSave} onCancel={closeForm}
                titleOptions={titleOptions} useCustomTitle={useCustomTitle} setUseCustomTitle={setUseCustomTitle} requiredTypes={requiredTypes} />
            )}
            <div className="space-y-3">
              {myCerts.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow"><p className="text-slate-400">No certifications uploaded yet.</p></div>
              ) : myCerts.map((cert) => {
                const badge = statusBadge(cert);
                return (
                  <div key={cert.id} className="rounded-2xl bg-white p-5 shadow flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-700">{cert.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                      </div>
                      <div className="text-sm text-slate-500 mt-0.5">
                        {cert.expirationDate
                          ? `Expires ${new Date(cert.expirationDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                          : "No expiration date"}
                      </div>
                      <a href={cert.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-600 hover:underline mt-1 inline-block">View file →</a>
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <button onClick={() => startEdit(cert)} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition font-medium">Edit</button>
                      <button onClick={() => handleDelete(cert.id)} className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600 transition font-medium">Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isManager && view === "all" && (
          <div className="max-w-3xl space-y-4">
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setShowRequiredOverview((s) => !s)} className="text-xs font-semibold text-orange-500 hover:underline">
                {showRequiredOverview ? "Hide" : "Show"} Required Certificates & CE Overview
              </button>
              <button onClick={() => setShowManageTypes((s) => !s)} className="text-xs font-semibold text-orange-500 hover:underline">
                {showManageTypes ? "Hide" : "Manage"} Required Certificate Types
              </button>
            </div>

            {showManageTypes && (
              <ManageRequiredTypesPanel requiredTypes={requiredTypes} refreshAll={refresh} />
            )}

            {showRequiredOverview && staff.filter((e) => !e.archived && getApplicableRoles(e).length > 0).map((emp) => (
              <RequiredCertsSection
                key={emp.id} employee={emp} certs={allCerts.filter((c) => c.employeeId === emp.id)}
                requiredTypes={requiredTypes} ceEntries={allCeEntries.filter((e) => e.employeeId === emp.id)}
                onAddCertForTitle={(title, existing) => openForRequiredItem(title, emp.id, existing)}
                refreshAll={refresh}
              />
            ))}

            {!showForm && (
              <div className="flex gap-2">
                <button onClick={() => openNewManager("personnel")}
                  className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                  + Add Personnel Certification
                </button>
                <button onClick={() => openNewManager("business")}
                  className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow hover:opacity-90 transition" style={{ backgroundColor: "#6b7280" }}>
                  + Add Business License
                </button>
              </div>
            )}
            {showForm && (
              <CertForm form={form} setForm={setForm} file={file} setFile={setFile} error={error} saving={saving}
                staff={staff} lockOwner={false} editingId={editingId} onSave={handleSave} onCancel={closeForm}
                titleOptions={titleOptions} useCustomTitle={useCustomTitle} setUseCustomTitle={setUseCustomTitle} requiredTypes={requiredTypes} />
            )}
            <div className="space-y-3">
              {allCerts.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow"><p className="text-slate-400">No certifications or licenses on file.</p></div>
              ) : allCerts.map((cert) => {
                const badge = statusBadge(cert);
                return (
                  <div key={cert.id} className="rounded-2xl bg-white p-5 shadow flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-700">{cert.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                        <span className="rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-xs">
                          {cert.ownerType === "business" ? "Business" : employeeName(cert.employeeId)}
                        </span>
                      </div>
                      <div className="text-sm text-slate-500 mt-0.5">
                        {cert.expirationDate
                          ? `Expires ${new Date(cert.expirationDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                          : "No expiration date"}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <a href={cert.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-600 hover:underline">View file →</a>
                        <button onClick={() => handleSendNow(cert.id)} className="text-xs text-orange-500 hover:underline">Send reminder now</button>
                        {notifyMsg[cert.id] && <span className="text-xs text-slate-400">{notifyMsg[cert.id]}</span>}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <button onClick={() => startEdit(cert)} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition font-medium">Edit</button>
                      <button onClick={() => handleDelete(cert.id)} className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600 transition font-medium">Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function CertificationsPage() {
  return (
    <AppIdentityGate>
      {(identity, logout) => <CertificationsPageBody identity={identity} logout={logout} />}
    </AppIdentityGate>
  );
}
