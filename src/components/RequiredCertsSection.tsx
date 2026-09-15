"use client";

import { useState } from "react";
import { Employee } from "@/types/employee";
import { Certification, NewCertInput, createCertification, updateCertification } from "@/lib/certsStore";
import {
  RequiredCertType, RequiredCertRole, CeCourseEntry,
  addCeCourseEntry, deleteCeCourseEntry, computeRequiredCertStatuses, addMonths,
} from "@/lib/requiredCertsStore";

// Which required-cert roles apply to this employee — a specialty dentist
// gets both "Dentist" and "Specialist" (for the extra board certificate).
export function getApplicableRoles(emp: Employee): RequiredCertRole[] {
  const roles: RequiredCertRole[] = [];
  if (emp.role === "Dentist") {
    roles.push("Dentist");
    if (emp.specialty && emp.specialty !== "General Dentist") roles.push("Specialist");
  }
  if (emp.role === "RDA") roles.push("RDA");
  if (emp.role === "Hygienist") roles.push("Hygienist");
  return roles;
}

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

export function RequiredCertsSection({
  employee, certs, requiredTypes, ceEntries, onAddCertForTitle, refreshAll,
}: {
  employee: Employee; certs: Certification[]; requiredTypes: RequiredCertType[]; ceEntries: CeCourseEntry[];
  onAddCertForTitle: (title: string, existing?: Certification) => void; refreshAll: () => void;
}) {
  const [loggingTypeId, setLoggingTypeId] = useState<string | null>(null);
  const [ceCourseName, setCeCourseName] = useState("");
  const [ceHours, setCeHours] = useState("");
  const [ceDate, setCeDate] = useState(new Date().toISOString().slice(0, 10));
  const [ceError, setCeError] = useState<string | null>(null);
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);
  const [completingTypeId, setCompletingTypeId] = useState<string | null>(null);
  const [completionDate, setCompletionDate] = useState(new Date().toISOString().slice(0, 10));
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionSaving, setCompletionSaving] = useState(false);

  const roles = getApplicableRoles(employee);
  if (roles.length === 0) return null;

  const certsByTitle = new Map(certs.map((c) => [c.title, { expirationDate: c.expirationDate }]));
  const today = new Date().toISOString().slice(0, 10);
  const statuses = computeRequiredCertStatuses(roles, requiredTypes, certsByTitle, ceEntries, today);
  if (statuses.length === 0) return null;

  async function handleLogCe(typeId: string) {
    const hours = Number(ceHours);
    if (!ceCourseName.trim() || !ceDate || isNaN(hours) || hours <= 0) { setCeError("Please enter a course name, hours, and date."); return; }
    const result = await addCeCourseEntry({ employeeId: employee.id, requiredCertTypeId: typeId, courseName: ceCourseName.trim(), hours, dateCompleted: ceDate });
    if (!result.ok) { setCeError(result.error ?? "Failed to save."); return; }
    setCeError(null);
    setCeCourseName("");
    setCeHours("");
    setLoggingTypeId(null);
    await refreshAll();
  }

  async function handleDeleteCe(id: string) {
    if (!confirm("Delete this CE course entry?")) return;
    await deleteCeCourseEntry(id);
    await refreshAll();
  }

  async function handleSaveCompletion(type: RequiredCertType, existing?: Certification) {
    if (!completionDate) { setCompletionError("Please enter a completion date."); return; }
    setCompletionSaving(true);
    const expirationDate = addMonths(completionDate, type.frequencyMonths);
    const input: NewCertInput = { ownerType: "personnel", employeeId: employee.id, title: type.title, expirationDate, fileUrl: existing?.fileUrl ?? "", fileName: existing?.fileName ?? "" };
    const saved = existing ? await updateCertification(existing.id, input) : await createCertification(input);
    setCompletionSaving(false);
    if (!saved) { setCompletionError("Failed to save — please try again."); return; }
    setCompletionError(null);
    setCompletingTypeId(null);
    await refreshAll();
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow mb-4">
      <h3 className="font-bold text-slate-700 mb-3">Required Certificates & CE — {employee.name}</h3>
      <div className="space-y-2">
        {statuses.map((status) => {
          const type = status.type;
          const existingCert = certs.find((c) => c.title === type.title);
          if (type.kind === "ce_hours") {
            const myEntries = ceEntries.filter((e) => e.requiredCertTypeId === type.id);
            return (
              <div key={type.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-semibold text-sm text-slate-700">{type.title}</span>
                    {status.missingLicense ? (
                      <span className="ml-2 text-xs text-amber-600 font-semibold">⚠️ Add the license expiration date first to track this</span>
                    ) : (
                      <span className={`ml-2 text-xs font-semibold ${status.satisfied ? "text-emerald-600" : "text-red-600"}`}>
                        {status.satisfied ? `✓ ${status.totalHoursInWindow} hrs logged this period` : "⚠️ Needed for renewal"}
                        {status.windowEnd ? ` (by ${new Date(status.windowEnd + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})` : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {myEntries.length > 0 && (
                      <button onClick={() => setExpandedTypeId(expandedTypeId === type.id ? null : type.id)} className="text-xs text-slate-400 hover:underline">
                        {expandedTypeId === type.id ? "Hide" : "History"} ({myEntries.length})
                      </button>
                    )}
                    <button onClick={() => { setLoggingTypeId(loggingTypeId === type.id ? null : type.id); setCeError(null); }} className="text-xs font-semibold text-orange-500 hover:underline">
                      {loggingTypeId === type.id ? "Cancel" : "+ Log a course"}
                    </button>
                  </div>
                </div>
                {loggingTypeId === type.id && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <input type="text" value={ceCourseName} onChange={(e) => setCeCourseName(e.target.value)} placeholder="Course name" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none sm:col-span-2" />
                    <input type="number" onFocus={(e) => e.target.select()} value={ceHours} onChange={(e) => setCeHours(e.target.value)} placeholder="Hours" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                    <input type="date" value={ceDate} onChange={(e) => setCeDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                    <button onClick={() => handleLogCe(type.id)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white sm:col-span-4 justify-self-start" style={{ backgroundColor: "#e8622a" }}>Save Course</button>
                    {ceError && <p className="text-xs text-red-600 sm:col-span-4">{ceError}</p>}
                  </div>
                )}
                {expandedTypeId === type.id && (
                  <div className="mt-2 space-y-1">
                    {myEntries.map((e) => (
                      <div key={e.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-1.5">
                        <span className="text-slate-600">{e.courseName} — {e.hours} hrs — {new Date(e.dateCompleted + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                        <button onClick={() => handleDeleteCe(e.id)} className="text-red-400 hover:underline">Delete</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          // license or standalone
          const expired = existingCert?.expirationDate ? existingCert.expirationDate < today : null;
          const expiringSoon = existingCert?.expirationDate ? daysUntil(existingCert.expirationDate) <= 30 && !expired : false;
          if (type.dateMode === "completion") {
            return (
              <div key={type.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-semibold text-sm text-slate-700">{type.title}</span>
                    {existingCert?.expirationDate ? (
                      <span className={`ml-2 text-xs font-semibold ${expired ? "text-red-600" : expiringSoon ? "text-amber-600" : "text-emerald-600"}`}>
                        {expired ? "⚠️ Expired" : expiringSoon ? "⚠️ Expiring soon" : "✓"} — expires {new Date(existingCert.expirationDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs font-semibold text-red-600">⚠️ Not on file</span>
                    )}
                  </div>
                  <button onClick={() => { setCompletingTypeId(completingTypeId === type.id ? null : type.id); setCompletionError(null); }} className="text-xs font-semibold text-orange-500 hover:underline">
                    {completingTypeId === type.id ? "Cancel" : existingCert ? "Update" : "+ Add"}
                  </button>
                </div>
                {completingTypeId === type.id && (
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-slate-500">Date completed:</label>
                    <input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                    <span className="text-xs text-slate-400">→ expires {new Date(addMonths(completionDate, type.frequencyMonths) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    <button onClick={() => handleSaveCompletion(type, existingCert)} disabled={completionSaving} className="rounded-lg px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
                      {completionSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                )}
                {completionError && <p className="text-xs text-red-600 mt-1">{completionError}</p>}
              </div>
            );
          }
          return (
            <div key={type.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
              <div>
                <span className="font-semibold text-sm text-slate-700">{type.title}</span>
                {existingCert?.expirationDate ? (
                  <span className={`ml-2 text-xs font-semibold ${expired ? "text-red-600" : expiringSoon ? "text-amber-600" : "text-emerald-600"}`}>
                    {expired ? "⚠️ Expired" : expiringSoon ? "⚠️ Expiring soon" : "✓"} — {new Date(existingCert.expirationDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                ) : (
                  <span className="ml-2 text-xs font-semibold text-red-600">⚠️ Not on file</span>
                )}
              </div>
              <button onClick={() => onAddCertForTitle(type.title, existingCert)} className="text-xs font-semibold text-orange-500 hover:underline">
                {existingCert ? "Update" : "+ Add"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
