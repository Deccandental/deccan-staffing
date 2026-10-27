"use client";

import { Fragment, useState } from "react";
import { Employee } from "@/types/employee";
import { Certification } from "@/lib/certsStore";
import { CeCourseEntry, RequiredCertType, addMonths, updateCeCourseEntry } from "@/lib/requiredCertsStore";
import { getApplicableRoles } from "@/components/RequiredCertsSection";

/**
 * One consolidated list of everything that earned CE credit.
 *
 * Credits arrive two ways and used to live in two unrelated places: courses
 * logged against a CE requirement, and certificates (BLS/CPR and the like)
 * carrying hours in their optional "CE credits earned" field. The second
 * kind appeared nowhere at all — you had to open each certificate
 * individually to discover it had hours attached — which made it impossible
 * to answer "what have I actually earned this renewal period?" without
 * clicking through every record.
 *
 * This merges both into a single dated list that can be printed for a
 * licence renewal or an audit.
 */

interface CeLogRow {
  entryId?: string; // set for logged courses, which can be edited and deleted here
  // Set for rows generated from a certificate. Those are edited in the
  // Certificates card, where the uploaded file and expiration live, rather
  // than here — an hours log is the wrong place to delete a document.
  certId?: string;
  requiredCertTypeId?: string;
  date: string;
  title: string;
  courseName: string;
  hours: number;
  source: "Course" | "Certificate";
  fileUrl?: string | null;
  inWindow: boolean;
  dateIsApproximate: boolean;
}

export default function CeLogPanel({
  employee, certs, ceEntries, requiredTypes, onDeleteEntry, onEditCert, onChanged,
}: {
  employee: Employee;
  certs: Certification[];
  ceEntries: CeCourseEntry[];
  requiredTypes: RequiredCertType[];
  onDeleteEntry?: (id: string) => void;
  onEditCert?: (certId: string) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ courseName: "", hours: "", dateCompleted: "", requiredCertTypeId: "" });
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const roles = getApplicableRoles(employee);
  const typeById = new Map(requiredTypes.map((t) => [t.id, t]));

  // The renewal window is anchored to the role's licence expiration, the
  // same way the CE requirements themselves are.
  const licenseType = requiredTypes.find((t) => t.kind === "license" && roles.includes(t.appliesToRole));
  const licenseExpiration = licenseType
    ? certs.find((c) => c.title === licenseType.title)?.expirationDate ?? null
    : null;
  const cycleMonths = requiredTypes.find((t) => t.kind === "total_ce_hours" && roles.includes(t.appliesToRole))?.frequencyMonths ?? 24;
  const windowStart = licenseExpiration ? addMonths(licenseExpiration, -cycleMonths) : null;
  const inWindow = (d: string) => (windowStart && licenseExpiration ? d >= windowStart && d <= licenseExpiration : true);

  const rows: CeLogRow[] = [];

  for (const e of ceEntries) {
    const type = typeById.get(e.requiredCertTypeId);
    rows.push({
      entryId: e.id,
      requiredCertTypeId: e.requiredCertTypeId,
      date: e.dateCompleted,
      title: type?.title ?? "CE course",
      courseName: e.courseName,
      hours: e.hours,
      source: "Course",
      fileUrl: e.fileUrl,
      inWindow: inWindow(e.dateCompleted),
      dateIsApproximate: false,
    });
  }

  for (const cert of certs) {
    if (cert.ceHours == null || cert.ceHours <= 0) continue;
    // Certificates store only an expiration date. Where the requirement is
    // completion-dated we can recover the completion date exactly; anywhere
    // else the date is flagged as approximate rather than quietly presented
    // as fact.
    const type = requiredTypes.find((t) => t.title === cert.title);
    let date = cert.expirationDate ?? cert.createdAt.slice(0, 10);
    let approximate = true;
    if (type && type.dateMode === "completion" && cert.expirationDate) {
      date = addMonths(cert.expirationDate, -type.frequencyMonths);
      approximate = false;
    }
    rows.push({
      certId: cert.id,
      date,
      title: cert.title,
      courseName: cert.title,
      hours: cert.ceHours,
      source: "Certificate",
      fileUrl: cert.fileUrl,
      inWindow: inWindow(date),
      dateIsApproximate: approximate,
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  const visible = showAll ? rows : rows.filter((r) => r.inWindow);
  const totalHours = visible.reduce((sum, r) => sum + r.hours, 0);

  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // What a logged course can be reassigned to: the requirements that apply
  // to this person. Reassigning matters when hours were filed against the
  // wrong requirement and the totals came out short in one place and over
  // in another.
  const assignableTypes = requiredTypes.filter((t) => roles.includes(t.appliesToRole));

  function startEditRow(r: CeLogRow) {
    if (!r.entryId) return;
    setEditForm({
      courseName: r.courseName,
      hours: String(r.hours),
      dateCompleted: r.date,
      requiredCertTypeId: r.requiredCertTypeId ?? "",
    });
    setEditError("");
    setEditingId(r.entryId);
  }

  async function saveEditRow() {
    if (!editingId) return;
    const hours = Number(editForm.hours);
    if (!editForm.courseName.trim()) { setEditError("Give the course a name."); return; }
    if (!Number.isFinite(hours) || hours <= 0) { setEditError("Hours must be a number greater than zero."); return; }
    if (!editForm.dateCompleted) { setEditError("Pick the date it was completed."); return; }
    setSavingEdit(true);
    const result = await updateCeCourseEntry(editingId, {
      courseName: editForm.courseName.trim(),
      hours,
      dateCompleted: editForm.dateCompleted,
      requiredCertTypeId: editForm.requiredCertTypeId,
    });
    setSavingEdit(false);
    if (!result.ok) { setEditError(result.error ?? "Couldn't save."); return; }
    setEditingId(null);
    await onChanged?.();
  }

  return (
    <div className="mt-3">
      <button onClick={() => setOpen((o) => !o)} className="text-xs font-semibold hover:underline print:hidden" style={{ color: "#3C3489" }}>
        {open ? "▼" : "▶"} CE log — every course and certificate that earned credit
      </button>

      {open && (
        <div className="mt-2" id="ce-log-printable">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2 print:hidden">
            <label className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(74,66,56,0.6)" }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all time (otherwise just the current renewal period)
            </label>
            <button onClick={() => window.print()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#3C3489" }}>
              Print this log
            </button>
          </div>

          <div className="hidden print:block mb-3">
            <h2 style={{ fontSize: 16, fontWeight: "bold" }}>{employee.name} — CE Log</h2>
            <p style={{ fontSize: 12 }}>
              {showAll
                ? "All recorded CE credit"
                : windowStart && licenseExpiration
                  ? `Renewal period ${fmt(windowStart)} – ${fmt(licenseExpiration)}`
                  : "Current renewal period"}
            </p>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-slate-400">No CE credit recorded{showAll ? "" : " in the current renewal period"}.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs" style={{ color: "rgba(74,66,56,0.55)" }}>
                  <th className="py-1.5 pr-2 font-medium">Date</th>
                  <th className="py-1.5 pr-2 font-medium">Course</th>
                  <th className="py-1.5 pr-2 font-medium">Counts toward</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Hours</th>
                  <th className="py-1.5 font-medium print:hidden"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <Fragment key={i}>
                  <tr className="border-b border-slate-100" style={{ opacity: r.inWindow ? 1 : 0.55 }}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {fmt(r.date)}
                      {r.dateIsApproximate && <span className="text-xs" style={{ color: "rgba(74,66,56,0.45)" }}> (approx.)</span>}
                    </td>
                    <td className="py-1.5 pr-2">{r.courseName}</td>
                    <td className="py-1.5 pr-2" style={{ color: "rgba(74,66,56,0.6)" }}>
                      {r.title}
                      <span className="text-xs"> · {r.source}</span>
                      {!r.inWindow && <span className="text-xs"> · outside current period</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-semibold">{r.hours}</td>
                    <td className="py-1.5 print:hidden">
                      <span className="flex items-center gap-2 justify-end">
                        {r.fileUrl && (
                          <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold hover:underline" style={{ color: "#185FA5" }}>View →</a>
                        )}
                        {r.entryId && (
                          <button onClick={() => startEditRow(r)} className="text-xs font-semibold hover:underline" style={{ color: "#e8622a" }}>Edit</button>
                        )}
                        {/* A certificate row is a view of a document. Editing it opens
                            that certificate's own form, where the file and expiration
                            are, instead of editing a copy of the hours here. */}
                        {r.certId && onEditCert && (
                          <button onClick={() => onEditCert(r.certId!)} className="text-xs font-semibold hover:underline" style={{ color: "#e8622a" }}>Edit</button>
                        )}
                        {r.entryId && onDeleteEntry && (
                          <button onClick={() => onDeleteEntry(r.entryId!)} className="text-xs text-red-400 hover:underline">Delete</button>
                        )}
                      </span>
                    </td>
                  </tr>
                  {r.entryId && editingId === r.entryId && (
                    <tr className="border-b border-slate-100 print:hidden" style={{ background: "#FBF7F1" }}>
                      <td colSpan={5} className="py-3 px-2">
                        <div className="grid gap-2 sm:grid-cols-4">
                          <input type="text" value={editForm.courseName}
                            onChange={(e) => setEditForm((f) => ({ ...f, courseName: e.target.value }))}
                            placeholder="Course name"
                            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none sm:col-span-2" />
                          <input type="number" step="0.5" onFocus={(e) => e.target.select()} value={editForm.hours}
                            onChange={(e) => setEditForm((f) => ({ ...f, hours: e.target.value }))}
                            placeholder="Hours"
                            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                          <input type="date" value={editForm.dateCompleted}
                            onChange={(e) => setEditForm((f) => ({ ...f, dateCompleted: e.target.value }))}
                            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                          <label className="text-xs sm:col-span-4" style={{ color: "rgba(74,66,56,0.6)" }}>
                            Counts toward
                            <select value={editForm.requiredCertTypeId}
                              onChange={(e) => setEditForm((f) => ({ ...f, requiredCertTypeId: e.target.value }))}
                              className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none">
                              {assignableTypes.map((t) => (
                                <option key={t.id} value={t.id}>{t.title}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {editError && <p className="text-xs font-semibold text-red-600 mt-2">⚠️ {editError}</p>}
                        <div className="flex items-center gap-3 mt-2">
                          <button onClick={saveEditRow} disabled={savingEdit}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: "#e8622a" }}>
                            {savingEdit ? "Saving…" : "Save changes"}
                          </button>
                          <button onClick={() => { setEditingId(null); setEditError(""); }} className="text-xs text-slate-400 hover:underline">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="py-2 text-right font-semibold" style={{ color: "rgba(74,66,56,0.7)" }}>Total</td>
                  <td className="py-2 pr-2 text-right font-bold">{totalHours} hrs</td>
                  <td className="print:hidden" />
                </tr>
              </tfoot>
            </table>
          )}

          {!licenseExpiration && (
            <p className="text-xs mt-2" style={{ color: "rgba(74,66,56,0.5)" }}>
              Add a licence expiration date to filter this log by renewal period.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
