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
  if (emp.role === "Assistant") roles.push("Assistant");
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
  employee, certs, requiredTypes, ceEntries, onAddCertForTitle, refreshAll, bare, filter,
}: {
  employee: Employee; certs: Certification[]; requiredTypes: RequiredCertType[]; ceEntries: CeCourseEntry[];
  onAddCertForTitle: (title: string, existing?: Certification) => void; refreshAll: () => void;
  bare?: boolean; // when true, renders without its own card wrapper/header — for embedding inside a parent card
  filter?: "certificates" | "ce"; // when set, shows only license/standalone ("certificates") or only ce_hours/one_time_ce/total_ce_hours ("ce")
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

  const today = new Date().toISOString().slice(0, 10);
  const CE_KINDS = new Set(["ce_hours", "one_time_ce", "total_ce_hours"]);
  const allStatuses = computeRequiredCertStatuses(roles, requiredTypes, certs, ceEntries, today);
  const statuses = filter === "ce" ? allStatuses.filter((s) => CE_KINDS.has(s.type.kind))
    : filter === "certificates" ? allStatuses.filter((s) => !CE_KINDS.has(s.type.kind))
    : allStatuses;
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

  const content = (
    <>
      {!bare && (
        <div className="flex items-center gap-2 mb-3">
          <span style={{ fontSize: 18 }}>📋</span>
          <h3 className="font-bold" style={{ color: "#4A4238" }}>Certifications & CE — {employee.name}</h3>
        </div>
      )}
      <div className="space-y-2">
        {statuses.map((status) => {
          const type = status.type;
          const existingCert = certs.find((c) => c.title === type.title);
          if (type.kind === "ce_hours") {
            const myEntries = ceEntries.filter((e) => e.requiredCertTypeId === type.id);
            return (
              <div key={type.id} className="rounded-xl p-3" style={{ background: "#FBF7F1" }}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: "#4A4238" }}>{type.title}</span>
                    {status.missingLicense ? (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "#FAEEDA", color: "#854F0B" }}>Add license first</span>
                    ) : status.satisfied ? (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "#EAF3DE", color: "#3B6D11" }}>
                        ✓ {status.totalHoursInWindow} hrs logged
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "#FCEBEB", color: "#A32D2D" }}>
                        Needed by {status.windowEnd ? new Date(status.windowEnd + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {myEntries.length > 0 && (
                      <button onClick={() => setExpandedTypeId(expandedTypeId === type.id ? null : type.id)} className="text-xs hover:underline" style={{ color: "rgba(74,66,56,0.5)" }}>
                        {expandedTypeId === type.id ? "Hide" : "History"} ({myEntries.length})
                      </button>
                    )}
                    <button onClick={() => { setLoggingTypeId(loggingTypeId === type.id ? null : type.id); setCeError(null); }} className="text-xs font-semibold hover:underline" style={{ color: "#e8622a" }}>
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
                        <span style={{ color: "rgba(74,66,56,0.7)" }}>{e.courseName} — {e.hours} hrs — {new Date(e.dateCompleted + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                        <button onClick={() => handleDeleteCe(e.id)} className="text-red-400 hover:underline">Delete</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (type.kind === "total_ce_hours") {
            const pct = status.missingLicense || !status.targetHours ? 0 : Math.min(100, Math.round((status.totalHoursInWindow / status.targetHours) * 100));
            return (
              <div key={type.id} className="rounded-xl p-3" style={{ background: "#FCE8D5" }}>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <span className="font-semibold text-sm" style={{ color: "#B8501E" }}>{type.title}</span>
                  {status.missingLicense ? (
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "#FAEEDA", color: "#854F0B" }}>Add license first</span>
                  ) : (
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: status.satisfied ? "#EAF3DE" : "white", color: status.satisfied ? "#3B6D11" : "#B8501E" }}>
                      {status.totalHoursInWindow} of {status.targetHours} hrs
                    </span>
                  )}
                </div>
                {!status.missingLicense && (
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(184,80,30,0.15)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: status.satisfied ? "#059669" : "#e8622a" }} />
                  </div>
                )}
              </div>
            );
          }
          if (type.kind === "one_time_ce") {
            const myEntries = ceEntries.filter((e) => e.requiredCertTypeId === type.id);
            return (
              <div key={type.id} className="rounded-xl p-3" style={{ background: "#FBF7F1" }}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: "#4A4238" }}>{type.title}</span>
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={status.satisfied ? { background: "#EAF3DE", color: "#3B6D11" } : { background: "#FCEBEB", color: "#A32D2D" }}>
                      {status.satisfied ? "✓ Completed (one-time)" : `${status.everCompletedHours ?? 0} of ${status.targetHours} hrs`}
                    </span>
                    {/* Whether it ALSO counts toward the current renewal is a
                        separate question — most people took this years ago,
                        which is perfectly fine but earns no CE credit now. */}
                    {status.satisfied && (
                      status.totalHoursInWindow > 0 ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "#E6F1FB", color: "#185FA5" }}>
                          +{status.totalHoursInWindow} hrs CE credit this renewal
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "#F1F0EE", color: "rgba(74,66,56,0.6)" }}>
                          No CE credit this renewal
                        </span>
                      )
                    )}
                  </div>
                  <button onClick={() => { setLoggingTypeId(loggingTypeId === type.id ? null : type.id); setCeError(null); }} className="text-xs font-semibold hover:underline" style={{ color: "#e8622a" }}>
                    {loggingTypeId === type.id ? "Cancel" : status.satisfied ? "Add more" : "+ Log hours"}
                  </button>
                </div>
                {loggingTypeId === type.id && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <input type="text" value={ceCourseName} onChange={(e) => setCeCourseName(e.target.value)} placeholder="Course name" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none sm:col-span-2" />
                    <input type="number" onFocus={(e) => e.target.select()} value={ceHours} onChange={(e) => setCeHours(e.target.value)} placeholder="Hours" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                    <input type="date" value={ceDate} onChange={(e) => setCeDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                    <button onClick={() => handleLogCe(type.id)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white sm:col-span-4 justify-self-start" style={{ backgroundColor: "#e8622a" }}>Save</button>
                    {ceError && <p className="text-xs text-red-600 sm:col-span-4">{ceError}</p>}
                  </div>
                )}
                {myEntries.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {myEntries.map((e) => (
                      <div key={e.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-1.5">
                        <span style={{ color: "rgba(74,66,56,0.7)" }}>{e.courseName} — {e.hours} hrs — {new Date(e.dateCompleted + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
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
          const statusPillStyle = expired ? { background: "#FCEBEB", color: "#A32D2D" } : expiringSoon ? { background: "#FAEEDA", color: "#854F0B" } : { background: "#EAF3DE", color: "#3B6D11" };
          if (type.dateMode === "completion") {
            return (
              <div key={type.id} className="rounded-xl p-3" style={{ background: "#FBF7F1" }}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: "#4A4238" }}>{type.title}</span>
                    {existingCert?.expirationDate ? (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={statusPillStyle}>
                        {expired ? "Expired" : expiringSoon ? "Expiring soon" : "✓ Current"} — {new Date(existingCert.expirationDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "#FCEBEB", color: "#A32D2D" }}>Not on file</span>
                    )}
                  </div>
                  <button onClick={() => { setCompletingTypeId(completingTypeId === type.id ? null : type.id); setCompletionError(null); }} className="text-xs font-semibold hover:underline" style={{ color: "#e8622a" }}>
                    {completingTypeId === type.id ? "Cancel" : existingCert ? "Update" : "+ Add"}
                  </button>
                </div>
                {completingTypeId === type.id && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <label className="text-xs" style={{ color: "rgba(74,66,56,0.6)" }}>Date completed:</label>
                    <input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                    <span className="text-xs" style={{ color: "rgba(74,66,56,0.5)" }}>→ expires {new Date(addMonths(completionDate, type.frequencyMonths) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
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
            <div key={type.id} className="flex items-center justify-between flex-wrap gap-2 rounded-xl p-3" style={{ background: "#FBF7F1" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm" style={{ color: "#4A4238" }}>{type.title}</span>
                {type.dateMode === "none" && existingCert ? (
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "#EAF3DE", color: "#3B6D11" }}>✓ On file</span>
                ) : existingCert?.expirationDate ? (
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={statusPillStyle}>
                    {expired ? "Expired" : expiringSoon ? "Expiring soon" : "✓ Current"} — {new Date(existingCert.expirationDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "#FCEBEB", color: "#A32D2D" }}>Not on file</span>
                )}
              </div>
              <button onClick={() => onAddCertForTitle(type.title, existingCert)} className="text-xs font-semibold hover:underline" style={{ color: "#e8622a" }}>
                {existingCert ? "Update" : "+ Add"}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );

  if (bare) return content;
  return <div className="rounded-2xl bg-white p-5 shadow mb-4">{content}</div>;
}
