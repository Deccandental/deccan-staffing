"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import {
  Certification, NewCertInput, CertOwnerType,
  loadAllCertifications, loadCertificationsForEmployee, loadDistinctTitles,
  createCertification, updateCertification, deleteCertification, uploadCertFile,
} from "@/lib/certsStore";
import CertsLoginGate, { CertsIdentity } from "@/components/CertsLoginGate";

interface FormState {
  ownerType: CertOwnerType;
  employeeId: string;
  title: string;
  expirationDate: string; // empty string = no expiration
}

const EMPTY_FORM: FormState = {
  ownerType: "personnel",
  employeeId: "",
  title: "",
  expirationDate: "",
};

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
  titleOptions, useCustomTitle, setUseCustomTitle,
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
}) {
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

      <div className="mb-4">
        <label className="block text-xs font-semibold text-slate-500 mb-1">Expiration Date (optional — leave blank if this never expires)</label>
        <input type="date" value={form.expirationDate} onChange={(e) => setForm((f) => ({ ...f, expirationDate: e.target.value }))}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
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

function CertificationsPageBody({ identity, logout }: { identity: CertsIdentity; logout: () => void }) {
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

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const s = await loadStaff();
    setStaff(s);
    const titles = await loadDistinctTitles();
    setTitleOptions(titles);
    if (identity.mode === "staff") {
      const mine = await loadCertificationsForEmployee(identity.employeeId);
      setMyCerts(mine);
    }
    if (identity.mode === "manager") {
      const all = await loadAllCertifications();
      setAllCerts(all);
    }
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

  function startEdit(cert: Certification) {
    setForm({
      ownerType: cert.ownerType,
      employeeId: cert.employeeId != null ? String(cert.employeeId) : "",
      title: cert.title,
      expirationDate: cert.expirationDate ?? "",
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
      const existing = (identity.mode === "manager" ? allCerts : myCerts).find((c) => c.id === editingId);
      fileUrl = existing?.fileUrl ?? "";
      fileName = existing?.fileName ?? "";
    }

    const input: NewCertInput = {
      ownerType: form.ownerType,
      employeeId: form.ownerType === "personnel" ? Number(form.employeeId) : null,
      title: form.title.trim(),
      expirationDate: form.expirationDate || null,
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
              {identity.mode === "manager" ? "👔 Manager view" : `👤 ${identity.employeeName}`}
            </span>
            <button onClick={logout} className="text-xs font-semibold text-gray-400 hover:text-red-500 underline">
              Not you?
            </button>
          </div>
        </header>

        {identity.mode === "manager" && (
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
                titleOptions={titleOptions} useCustomTitle={useCustomTitle} setUseCustomTitle={setUseCustomTitle} />
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

        {identity.mode === "manager" && view === "all" && (
          <div className="max-w-3xl space-y-4">
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
                titleOptions={titleOptions} useCustomTitle={useCustomTitle} setUseCustomTitle={setUseCustomTitle} />
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
    <CertsLoginGate>
      {(identity, logout) => <CertificationsPageBody identity={identity} logout={logout} />}
    </CertsLoginGate>
  );
}
