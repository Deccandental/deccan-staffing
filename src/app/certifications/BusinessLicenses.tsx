"use client";

import type { ReactNode } from "react";
import type { Certification } from "@/lib/certsStore";

/**
 * Business licenses in one place: only the practice's own licenses (not staff certifications),
 * soonest expiry first, with status, the uploaded file, and edit / delete / reminder.
 */

function daysUntil(dateStr: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(dateStr + "T00:00:00").getTime() - today) / 86400000);
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

export default function BusinessLicenses({
  licenses, showForm, formNode, onAdd, onEdit, onDelete, onRemind, notifyMsg,
}: {
  licenses: Certification[];
  showForm: boolean;
  formNode: ReactNode;
  onAdd: () => void;
  onEdit: (c: Certification) => void;
  onDelete: (id: string) => void;
  onRemind: (id: string) => void;
  notifyMsg: Record<string, string>;
}) {
  const list = [...licenses].sort((a, b) =>
    (a.expirationDate ?? "9999-12-31").localeCompare(b.expirationDate ?? "9999-12-31") || a.title.localeCompare(b.title));
  const expired = list.filter((c) => c.expirationDate && daysUntil(c.expirationDate) < 0).length;
  const soon = list.filter((c) => c.expirationDate && daysUntil(c.expirationDate) >= 0 && daysUntil(c.expirationDate) <= 60).length;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-500">
          {list.length} business license{list.length === 1 ? "" : "s"} on file
          {expired > 0 && <span className="text-red-600 font-semibold"> · {expired} expired</span>}
          {soon > 0 && <span className="text-amber-600 font-semibold"> · {soon} expiring within 60 days</span>}
        </div>
        {!showForm && (
          <button onClick={onAdd} className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
            + Add Business License
          </button>
        )}
      </div>

      {showForm && formNode}

      <div className="space-y-3">
        {list.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow"><p className="text-slate-400">No business licenses on file yet.</p></div>
        ) : list.map((cert) => {
          const badge = statusBadge(cert);
          const needsReminder = !!cert.expirationDate && daysUntil(cert.expirationDate) <= 60;
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
                <div className="mt-1 flex items-center gap-3 flex-wrap">
                  <a href={cert.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-600 hover:underline">View file →</a>
                  {cert.fileName && <span className="text-xs text-slate-400 truncate">{cert.fileName}</span>}
                  {needsReminder && (
                    <button onClick={() => onRemind(cert.id)} className="text-xs text-slate-400 hover:underline">{notifyMsg[cert.id] ?? "Send reminder"}</button>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <button onClick={() => onEdit(cert)} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition font-medium">Edit</button>
                <button onClick={() => onDelete(cert.id)} className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600 transition font-medium">Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
