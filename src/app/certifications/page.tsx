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
  RequiredCertType, RequiredCertRole, RequiredCertStatus, CeCourseEntry, GroupedRequiredType,
  loadRequiredCertTypes, createRequiredCertType, createRequiredCertTypeForRoles, renameRequiredCertType,
  updateRequiredCertType, deleteRequiredCertType, deleteRequiredCertTypesByTitle, groupRequiredTypesByTitle,
  addRoleToRequiredType, removeRoleFromRequiredType,
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

interface GroupedCertRow {
  title: string;
  isRequired: boolean;
  current: string[];
  expiringSoon: string[];
  expired: string[];
  missing: string[];
  optionalOnFile: { name: string; statusText: string; isExpired: boolean }[];
}

// Builds one row per certificate title in use — required titles get
// current/expiring/expired/missing buckets scoped to whichever roles the
// requirement applies to; titles that aren't tracked as a requirement just
// list whoever currently has one on file.
function buildGroupedCertRows(
  requiredTypes: RequiredCertType[], staff: Employee[], allCerts: Certification[], allCeEntries: CeCourseEntry[], today: string
): GroupedCertRow[] {
  const groups = groupRequiredTypesByTitle(requiredTypes);
  const rows: GroupedCertRow[] = [];

  for (const group of groups) {
    const current: string[] = [];
    const expiringSoon: string[] = [];
    const expired: string[] = [];
    const missing: string[] = [];
    const applicable = staff.filter((e) => !e.archived && getApplicableRoles(e).some((r) => group.roles.includes(r)));

    for (const emp of applicable) {
      const empCerts = allCerts.filter((c) => c.employeeId === emp.id);
      const empCe = allCeEntries.filter((e) => e.employeeId === emp.id);
      const statuses = computeRequiredCertStatuses(getApplicableRoles(emp), requiredTypes, empCerts, empCe, today);
      const status = statuses.find((s) => s.type.title === group.title);
      if (!status) { missing.push(emp.name); continue; }
      if (group.kind === "ce_hours" || group.kind === "total_ce_hours" || group.kind === "one_time_ce") {
        (status.satisfied ? current : missing).push(emp.name);
      } else if (group.dateMode === "none") {
        (status.satisfied ? current : missing).push(emp.name);
      } else if (!status.expirationDate) {
        missing.push(emp.name);
      } else if (status.expirationDate < today) {
        expired.push(emp.name);
      } else if (daysUntil(status.expirationDate) <= 30) {
        expiringSoon.push(emp.name);
      } else {
        current.push(emp.name);
      }
    }
    rows.push({ title: group.title, isRequired: true, current, expiringSoon, expired, missing, optionalOnFile: [] });
  }

  const requiredTitleSet = new Set(groups.map((g) => g.title));
  const optionalTitles = Array.from(new Set(allCerts.map((c) => c.title))).filter((t) => !requiredTitleSet.has(t));
  for (const title of optionalTitles) {
    const onFile = allCerts.filter((c) => c.title === title).map((c) => {
      const name = c.ownerType === "business" ? "Business" : (staff.find((e) => e.id === c.employeeId)?.name ?? "Unknown");
      const isExpired = !!c.expirationDate && c.expirationDate < today;
      const statusText = c.expirationDate
        ? `${isExpired ? "Expired" : "Expires"} ${new Date(c.expirationDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : "No expiration";
      return { name, statusText, isExpired };
    });
    rows.push({ title, isRequired: false, current: [], expiringSoon: [], expired: [], missing: [], optionalOnFile: onFile });
  }

  return rows.sort((a, b) => a.title.localeCompare(b.title));
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
  form, setForm, file, setFile, error, saving, staff, lockOwner, editingId, onSave, onCancel, onDelete,
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
  onDelete?: () => void;
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
        {editingId && onDelete && (
          <button onClick={onDelete} className="rounded-xl border border-red-200 px-5 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50 transition ml-auto">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function ManageRequiredTypesPanel({
  requiredTypes, allCerts, refreshAll,
}: { requiredTypes: RequiredCertType[]; allCerts: Certification[]; refreshAll: () => void }) {
  const ALL_ROLES: RequiredCertRole[] = ["Dentist", "RDA", "Hygienist", "Specialist", "Assistant"];
  const [newTitle, setNewTitle] = useState("");
  const [newRoles, setNewRoles] = useState<RequiredCertRole[]>([]);
  const [newKind, setNewKind] = useState<"license" | "ce_hours" | "standalone" | "one_time_ce" | "total_ce_hours">("standalone");
  const [newDateMode, setNewDateMode] = useState<"expiration" | "completion" | "none">("completion");
  const [newFrequency, setNewFrequency] = useState("24");
  const [newTargetHours, setNewTargetHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [promotingTitle, setPromotingTitle] = useState<string | null>(null);
  const [promoteRoles, setPromoteRoles] = useState<RequiredCertRole[]>([]);

  const groups = groupRequiredTypesByTitle(requiredTypes);
  const requiredTitles = new Set(groups.map((g) => g.title));
  const optionalTitles = Array.from(new Set(allCerts.map((c) => c.title))).filter((t) => !requiredTitles.has(t)).sort((a, b) => a.localeCompare(b));

  function toggleNewRole(role: RequiredCertRole) {
    setNewRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]);
  }

  async function handleAdd() {
    if (!newTitle.trim()) { setError("Please enter a title."); return; }
    if (newRoles.length === 0) { setError("Please select at least one role."); return; }
    const result = await createRequiredCertTypeForRoles({
      title: newTitle.trim(), kind: newKind, frequencyMonths: Number(newFrequency) || 24,
      sortOrder: 0, dateMode: newDateMode, targetHours: newTargetHours ? Number(newTargetHours) : null,
    }, newRoles);
    if (!result.ok) { setError(result.error ?? "Failed to add."); return; }
    setError(null);
    setNewTitle("");
    setNewRoles([]);
    await refreshAll();
  }

  async function handleToggleRole(group: GroupedRequiredType, role: RequiredCertRole) {
    if (group.roles.includes(role)) {
      await removeRoleFromRequiredType(group, role, requiredTypes);
    } else {
      await addRoleToRequiredType(group, role);
    }
    await refreshAll();
  }

  async function handleRename(group: GroupedRequiredType) {
    if (!renameValue.trim() || renameValue.trim() === group.title) { setRenamingTitle(null); return; }
    const result = await renameRequiredCertType(group.title, renameValue.trim());
    if (!result.ok) { setError(result.error ?? "Failed to rename."); return; }
    setError(null);
    setRenamingTitle(null);
    await refreshAll();
  }

  async function handleMakeOptional(title: string) {
    if (!confirm(`Make "${title}" optional? It won't be tracked as a requirement for any role, but won't delete anyone's existing certifications.`)) return;
    await deleteRequiredCertTypesByTitle(title);
    await refreshAll();
  }

  function togglePromoteRole(role: RequiredCertRole) {
    setPromoteRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]);
  }

  async function handleMakeRequired(title: string) {
    if (promoteRoles.length === 0) { setError("Please select at least one role."); return; }
    const result = await createRequiredCertTypeForRoles({
      title, kind: "standalone", frequencyMonths: 24, sortOrder: 0, dateMode: "expiration", targetHours: null,
    }, promoteRoles);
    if (!result.ok) { setError(result.error ?? "Failed to update."); return; }
    setError(null);
    setPromotingTitle(null);
    setPromoteRoles([]);
    await refreshAll();
  }

  function roleCheckboxes(selected: RequiredCertRole[], onToggle: (r: RequiredCertRole) => void) {
    return (
      <div className="flex gap-3 flex-wrap">
        {ALL_ROLES.map((r) => (
          <label key={r} className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={selected.includes(r)} onChange={() => onToggle(r)} />
            {r}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <h3 className="font-bold text-slate-700 mb-3">Add a Required Certificate Type</h3>
      <div className="grid gap-2 sm:grid-cols-4 mb-2">
        <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none sm:col-span-2" />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as any)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
          <option value="license">License (expiration date)</option>
          <option value="standalone">Standalone cert</option>
          <option value="ce_hours">CE hours (logged courses)</option>
          <option value="one_time_ce">One-time CE (never expires)</option>
          <option value="total_ce_hours">Total CE hours (running tally)</option>
        </select>
        <input type="number" value={newFrequency} onChange={(e) => setNewFrequency(e.target.value)} placeholder="Months" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
      </div>
      <div className="flex gap-2 mb-2 flex-wrap">
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
      </div>
      <div className="mb-3">
        <p className="text-xs font-semibold text-slate-500 mb-1">Applies to</p>
        {roleCheckboxes(newRoles, toggleNewRole)}
      </div>
      <button onClick={handleAdd} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition mb-4" style={{ backgroundColor: "#e8622a" }}>+ Add Required Type</button>
      {error && <p className="text-sm text-red-600 mb-3">⚠️ {error}</p>}

      <h3 className="font-bold text-slate-700 mb-2 mt-6">Required Certificate Types</h3>
      <div className="space-y-1 mb-6">
        {groups.map((group) => (
          <div key={group.title} className="rounded-lg bg-slate-50 p-3">
            {renamingTitle === group.title ? (
              <div className="flex items-center gap-2">
                <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none flex-1" autoFocus />
                <button onClick={() => handleRename(group)} className="text-xs font-semibold text-emerald-600 hover:underline">Save</button>
                <button onClick={() => setRenamingTitle(null)} className="text-xs text-slate-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-slate-700">
                  <strong>{group.title}</strong>
                  <span className="text-xs text-slate-400 ml-2">
                    {group.kind === "ce_hours" ? "CE hours" : group.kind === "license" ? "License" : group.kind === "one_time_ce" ? `One-time CE (${group.targetHours ?? "?"} hrs)` : group.kind === "total_ce_hours" ? `Total CE hours (target ${group.targetHours ?? "?"})` : "Standalone"}
                    {" · every "}{group.frequencyMonths}mo
                    {(group.kind === "license" || group.kind === "standalone") && ` · ${group.dateMode === "completion" ? "completion date" : group.dateMode === "none" ? "never expires" : "expiration date"}`}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <button onClick={() => { setRenamingTitle(group.title); setRenameValue(group.title); }} className="text-xs text-orange-500 hover:underline">Rename</button>
                  <button onClick={() => handleMakeOptional(group.title)} className="text-xs text-red-400 hover:underline">Make optional</button>
                </span>
              </div>
            )}
            {roleCheckboxes(group.roles, (r) => handleToggleRole(group, r))}
          </div>
        ))}
      </div>

      <h3 className="font-bold text-slate-700 mb-2">Optional Certificates</h3>
      <p className="text-xs text-slate-400 mb-2">Titles currently in use that aren't tracked as a requirement for any role.</p>
      <div className="space-y-1">
        {optionalTitles.length === 0 ? (
          <p className="text-sm text-slate-400">None — every title in use is currently required for at least one role.</p>
        ) : optionalTitles.map((title) => (
          <div key={title} className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-700">{title}</span>
              <button onClick={() => { setPromotingTitle(promotingTitle === title ? null : title); setPromoteRoles([]); }} className="text-xs text-orange-500 hover:underline">
                {promotingTitle === title ? "Cancel" : "Make required"}
              </button>
            </div>
            {promotingTitle === title && (
              <div className="mt-2">
                {roleCheckboxes(promoteRoles, togglePromoteRole)}
                <button onClick={() => handleMakeRequired(title)} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: "#e8622a" }}>Save</button>
                <p className="text-xs text-slate-400 mt-1">Added as a standalone cert with an expiration date — you can change its kind afterward in the list above.</p>
              </div>
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
  const [view, setView] = useState<"mine" | "all" | "manage">("mine");
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

  async function handleDeleteFromForm() {
    if (!editingId) return;
    if (!confirm("Delete this certification/license? This can't be undone.")) return;
    await deleteCertification(editingId);
    closeForm();
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
            <button onClick={() => setView("manage")} className="rounded-xl px-4 py-2 text-sm font-semibold transition"
              style={view === "manage" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>
              Manage Required Types
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
                staff={staff} lockOwner editingId={editingId} onSave={handleSave} onCancel={closeForm} onDelete={editingId ? handleDeleteFromForm : undefined}
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
            <button onClick={() => setShowRequiredOverview((s) => !s)} className="text-xs font-semibold text-orange-500 hover:underline">
              {showRequiredOverview ? "Hide" : "Show"} Required Certificates & CE Overview (per employee)
            </button>

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
                staff={staff} lockOwner={false} editingId={editingId} onSave={handleSave} onCancel={closeForm} onDelete={editingId ? handleDeleteFromForm : undefined}
                titleOptions={titleOptions} useCustomTitle={useCustomTitle} setUseCustomTitle={setUseCustomTitle} requiredTypes={requiredTypes} />
            )}

            <div className="space-y-3">
              {allCerts.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow"><p className="text-slate-400">No certifications or licenses on file.</p></div>
              ) : buildGroupedCertRows(requiredTypes, staff, allCerts, allCeEntries, new Date().toISOString().slice(0, 10)).map((row) => {
                function findCert(name: string): Certification | undefined {
                  const emp = staff.find((e) => e.name === name);
                  return allCerts.find((c) => c.title === row.title && (emp ? c.employeeId === emp.id : c.ownerType === "business"));
                }
                function openName(name: string) {
                  const emp = staff.find((e) => e.name === name);
                  const existing = findCert(name);
                  if (existing) { startEdit(existing); return; }
                  if (emp) openForRequiredItem(row.title, emp.id);
                }
                return (
                  <div key={row.title} className="rounded-2xl bg-white p-5 shadow">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-slate-700">{row.title}</span>
                      {!row.isRequired && <span className="rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-xs">Optional</span>}
                    </div>
                    {row.isRequired ? (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <div className="text-xs font-semibold text-emerald-600 mb-1">Current — {row.current.length}</div>
                          {row.current.length === 0 ? <p className="text-xs text-slate-300">—</p> : row.current.map((n) => (
                            <button key={n} onClick={() => openName(n)} className="block text-sm text-slate-600 hover:underline text-left">{n}</button>
                          ))}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-amber-600 mb-1">Expiring soon — {row.expiringSoon.length}</div>
                          {row.expiringSoon.length === 0 ? <p className="text-xs text-slate-300">—</p> : row.expiringSoon.map((n) => {
                            const cert = findCert(n);
                            return (
                              <div key={n} className="flex items-center gap-2">
                                <button onClick={() => openName(n)} className="text-sm text-amber-700 hover:underline text-left">{n}</button>
                                {cert && <button onClick={() => handleSendNow(cert.id)} className="text-xs text-slate-400 hover:underline">{notifyMsg[cert.id] ?? "remind"}</button>}
                              </div>
                            );
                          })}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-red-500 mb-1">Expired / Missing — {row.expired.length + row.missing.length}</div>
                          {row.expired.length === 0 && row.missing.length === 0 ? <p className="text-xs text-slate-300">—</p> : (
                            <>
                              {row.expired.map((n) => {
                                const cert = findCert(n);
                                return (
                                  <div key={n} className="flex items-center gap-2">
                                    <button onClick={() => openName(n)} className="text-sm text-red-500 hover:underline text-left">{n} (expired)</button>
                                    {cert && <button onClick={() => handleSendNow(cert.id)} className="text-xs text-slate-400 hover:underline">{notifyMsg[cert.id] ?? "remind"}</button>}
                                  </div>
                                );
                              })}
                              {row.missing.map((n) => <button key={n} onClick={() => openName(n)} className="block text-sm text-red-500 hover:underline text-left">{n}</button>)}
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {row.optionalOnFile.map((entry) => (
                          <div key={entry.name} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                            <button onClick={() => openName(entry.name)} className="text-slate-600 hover:underline">{entry.name}</button>
                            <span className={entry.isExpired ? "text-red-500 text-xs font-semibold" : "text-slate-400 text-xs"}>{entry.statusText}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isManager && view === "manage" && (
          <div className="max-w-3xl">
            <ManageRequiredTypesPanel requiredTypes={requiredTypes} allCerts={allCerts} refreshAll={refresh} />
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
