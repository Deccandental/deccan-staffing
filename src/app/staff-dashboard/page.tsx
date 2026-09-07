"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import { LeaveRequest } from "@/types/leave";
import { loadLeaveRequests } from "@/lib/leaveStore";
import {
  Certification, NewCertInput, loadCertificationsForEmployee, loadDistinctTitles,
  createCertification, updateCertification, uploadCertFile,
} from "@/lib/certsStore";
import { StaffEvent, loadUpcomingEvents } from "@/lib/eventsStore";
import { UpcomingShift, loadUpcomingShiftsForEmployee } from "@/lib/staffSchedule";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";

const REASON_LABELS: Record<string, string> = {
  sick: "Sick Leave", pto: "PTO / Vacation", leave: "Personal Leave", other: "Other",
};

const LEAVE_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  denied: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-400",
};

const ROLE_ICONS: Record<UpcomingShift["role"], string> = {
  Dentist: "🦷", Assistant: "🤝", "Front Desk": "🖥️", Hygienist: "✨", Floater: "🔄",
};

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

function certBadge(cert: Certification): { label: string; className: string } {
  if (!cert.expirationDate) return { label: "No expiration", className: "bg-slate-100 text-slate-500" };
  const days = daysUntil(cert.expirationDate);
  if (days < 0) return { label: "Expired", className: "bg-red-100 text-red-700" };
  if (days <= 7) return { label: `Expires in ${days}d`, className: "bg-red-100 text-red-700" };
  if (days <= 30) return { label: `Expires in ${days}d`, className: "bg-amber-100 text-amber-700" };
  if (days <= 60) return { label: `Expires in ${days}d`, className: "bg-yellow-100 text-yellow-700" };
  return { label: "Current", className: "bg-green-100 text-green-700" };
}

interface CertFormState {
  title: string;
  expirationDate: string;
}

const EMPTY_CERT_FORM: CertFormState = { title: "", expirationDate: "" };

function DashboardPageBody({ identity, logout }: { identity: AppIdentity; logout: () => void }) {
  const isManager = identity.canAdmin;
  const [staff, setStaff] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(identity.mode === "staff" ? (identity.employeeId ?? null) : null);
  const [shifts, setShifts] = useState<UpcomingShift[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [certs, setCerts] = useState<Certification[]>([]);
  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  const [events, setEvents] = useState<StaffEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const [showCertForm, setShowCertForm] = useState(false);
  const [editingCertId, setEditingCertId] = useState<string | null>(null);
  const [certForm, setCertForm] = useState<CertFormState>(EMPTY_CERT_FORM);
  const [useCustomTitle, setUseCustomTitle] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certError, setCertError] = useState("");
  const [certSaving, setCertSaving] = useState(false);

  useEffect(() => { loadStaff().then(setStaff); }, []);

  useEffect(() => {
    if (selectedId == null) return;
    let cancelled = false;
    setLoading(true);
    const todayStr = new Date().toISOString().split("T")[0];
    Promise.all([
      loadUpcomingShiftsForEmployee(selectedId),
      loadLeaveRequests(),
      loadCertificationsForEmployee(selectedId),
      loadUpcomingEvents(todayStr),
      loadDistinctTitles(),
    ]).then(([shiftData, leaveData, certData, eventData, titles]) => {
      if (cancelled) return;
      setShifts(shiftData);
      setLeaveRequests(leaveData.filter((r) => r.employeeId === selectedId));
      setCerts(certData);
      setEvents(eventData.filter((ev) => ev.inviteAll || ev.invitedStaffIds.includes(selectedId)));
      setTitleOptions(titles);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  const selectedEmployee = staff.find((e) => e.id === selectedId);

  function openNewCert() {
    setCertForm(EMPTY_CERT_FORM);
    setEditingCertId(null);
    setCertFile(null);
    setCertError("");
    setUseCustomTitle(titleOptions.length === 0);
    setShowCertForm(true);
  }

  function startEditCert(cert: Certification) {
    setCertForm({ title: cert.title, expirationDate: cert.expirationDate ?? "" });
    setEditingCertId(cert.id);
    setCertFile(null);
    setCertError("");
    setUseCustomTitle(!titleOptions.includes(cert.title));
    setShowCertForm(true);
  }

  function closeCertForm() {
    setShowCertForm(false);
    setEditingCertId(null);
    setCertForm(EMPTY_CERT_FORM);
    setCertFile(null);
    setCertError("");
  }

  async function handleSaveCert() {
    if (selectedId == null) return;
    setCertError("");
    if (!certForm.title.trim()) { setCertError("Please enter a document name."); return; }
    if (!editingCertId && !certFile) { setCertError("Please choose a file to upload."); return; }

    setCertSaving(true);
    let fileUrl = "";
    let fileName = "";
    if (certFile) {
      const uploaded = await uploadCertFile(certFile);
      if ("error" in uploaded) { setCertError(uploaded.error); setCertSaving(false); return; }
      fileUrl = uploaded.url;
      fileName = uploaded.name;
    } else if (editingCertId) {
      const existing = certs.find((c) => c.id === editingCertId);
      fileUrl = existing?.fileUrl ?? "";
      fileName = existing?.fileName ?? "";
    }

    const input: NewCertInput = {
      ownerType: "personnel",
      employeeId: selectedId,
      title: certForm.title.trim(),
      expirationDate: certForm.expirationDate || null,
      fileUrl, fileName,
    };

    const saved = editingCertId ? await updateCertification(editingCertId, input) : await createCertification(input);
    setCertSaving(false);
    if (!saved) { setCertError("Something went wrong — not saved. Try again."); return; }

    closeCertForm();
    const [freshCerts, freshTitles] = await Promise.all([loadCertificationsForEmployee(selectedId), loadDistinctTitles()]);
    setCerts(freshCerts);
    setTitleOptions(freshTitles);
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">Staff Dashboard</h1>
            <p className="mt-1 text-slate-500">Upcoming shifts, leave requests, and certifications in one place.</p>
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
          <div className="mb-6 max-w-sm">
            <label className="block text-xs font-semibold text-slate-500 mb-1">View staff member</label>
            <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none">
              <option value="">Select a staff member...</option>
              {staff.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.role}{e.archived ? " (archived)" : ""}</option>)}
            </select>
          </div>
        )}

        {selectedId == null ? (
          <div className="rounded-2xl bg-white p-10 text-center shadow max-w-lg">
            <p className="text-slate-400">Select a staff member above to view their dashboard.</p>
          </div>
        ) : loading ? (
          <div className="rounded-2xl bg-white p-10 text-center shadow max-w-lg">
            <p className="text-slate-400">Loading…</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2 max-w-5xl">
            {selectedEmployee && (
              <div className="lg:col-span-2 rounded-2xl bg-white p-5 shadow flex items-center gap-3">
                <div className="h-12 w-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                  style={{ backgroundColor: selectedEmployee.color }}>
                  {selectedEmployee.name.charAt(0)}
                </div>
                <div>
                  <div className="font-bold text-lg text-slate-700">{selectedEmployee.name}</div>
                  <div className="text-sm text-slate-400">{selectedEmployee.specialty ?? selectedEmployee.role}{selectedEmployee.email ? ` · ${selectedEmployee.email}` : ""}</div>
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-white p-5 shadow">
              <h2 className="font-bold text-slate-700 mb-3">📅 Upcoming Shifts (next 3 weeks)</h2>
              {shifts.length === 0 ? (
                <p className="text-sm text-slate-400">No upcoming shifts scheduled.</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {shifts.map((s, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium text-slate-700">
                          {new Date(s.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                        {s.detail && <span className="text-slate-400 ml-2 text-xs">{s.detail}</span>}
                      </div>
                      <span className="text-xs font-semibold text-slate-500">{ROLE_ICONS[s.role]} {s.role}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-slate-700">📝 Leave Requests</h2>
                <a href="/leave" className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                  + Submit Leave Request
                </a>
              </div>
              {leaveRequests.length === 0 ? (
                <p className="text-sm text-slate-400">No leave requests on file.</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {leaveRequests.map((req) => (
                    <div key={req.id} className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">
                          {new Date(req.startDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {req.startDate !== req.endDate && ` – ${new Date(req.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LEAVE_STATUS_STYLES[req.status]}`}>
                          {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{REASON_LABELS[req.reason] ?? req.reason} · {req.totalDays} day{req.totalDays !== 1 ? "s" : ""}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow">
              <h2 className="font-bold text-slate-700 mb-3">📌 Events</h2>
              {events.length === 0 ? (
                <p className="text-sm text-slate-400">No upcoming events.</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {events.map((ev) => (
                    <div key={ev.id} className="rounded-xl px-3 py-2" style={{ background: ev.mandatory ? "#fef2f2" : "#faf5ff" }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium" style={{ color: ev.mandatory ? "#dc2626" : "#7c3aed" }}>{ev.title}</span>
                        {ev.mandatory && <span className="rounded-full bg-red-100 text-red-600 text-xs font-semibold px-2 py-0.5 flex-shrink-0">Mandatory</span>}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {new Date(ev.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        {ev.time ? ` · ${ev.time}${ev.endTime ? `–${ev.endTime}` : ""}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-slate-700">📄 Certifications</h2>
                {!showCertForm && (
                  <button onClick={openNewCert} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                    + Add Certification
                  </button>
                )}
              </div>

              {showCertForm && (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 mb-3 space-y-2">
                  {certError && <p className="text-xs text-red-500">{certError}</p>}
                  {!useCustomTitle ? (
                    <select
                      value={titleOptions.includes(certForm.title) ? certForm.title : ""}
                      onChange={(e) => {
                        if (e.target.value === "__new__") { setUseCustomTitle(true); setCertForm((f) => ({ ...f, title: "" })); }
                        else setCertForm((f) => ({ ...f, title: e.target.value }));
                      }}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none">
                      <option value="">Select a document name...</option>
                      {titleOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                      <option value="__new__">+ Add new document name...</option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input type="text" value={certForm.title} onChange={(e) => setCertForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="e.g. CPR Certification" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                      {titleOptions.length > 0 && (
                        <button type="button" onClick={() => { setUseCustomTitle(false); setCertForm((f) => ({ ...f, title: "" })); }}
                          className="flex-shrink-0 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500 hover:bg-white">
                          Choose existing
                        </button>
                      )}
                    </div>
                  )}
                  <input type="date" value={certForm.expirationDate} onChange={(e) => setCertForm((f) => ({ ...f, expirationDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                  <p className="text-xs text-slate-400 -mt-1">Leave date blank if this never expires.</p>
                  <input type="file" onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none" />
                  {editingCertId && <p className="text-xs text-slate-400">Leave file blank to keep the existing one.</p>}
                  <div className="flex gap-2">
                    <button onClick={handleSaveCert} disabled={certSaving}
                      className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
                      {certSaving ? "Saving…" : editingCertId ? "Save Changes" : "Upload"}
                    </button>
                    <button onClick={closeCertForm} className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {certs.length === 0 ? (
                <p className="text-sm text-slate-400">No certifications on file.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {certs.map((cert) => {
                    const badge = certBadge(cert);
                    return (
                      <div key={cert.id} className="rounded-xl bg-slate-50 px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-700 truncate">{cert.title}</div>
                          <div className="text-xs text-slate-400">
                            {cert.expirationDate
                              ? new Date(cert.expirationDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                              : "No expiration"}
                          </div>
                          <button onClick={() => startEditCert(cert)} className="text-xs text-cyan-600 hover:underline mt-0.5">Edit</button>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold flex-shrink-0 ${badge.className}`}>{badge.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function StaffDashboardPage() {
  return (
    <AppIdentityGate>
      {(identity, logout) => <DashboardPageBody identity={identity} logout={logout} />}
    </AppIdentityGate>
  );
}
