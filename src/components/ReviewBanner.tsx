"use client";

import { useState, useEffect } from "react";
import { getSessionToken } from "@/lib/secureData";

/**
 * A notice at the top of a staff member's own dashboard when documents are waiting for their review.
 * Red when any are past their review date. Shows nothing when there is nothing to review.
 */
export default function ReviewBanner({ show }: { show: boolean }) {
  const [counts, setCounts] = useState<{ pending: number; overdue: number } | null>(null);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    fetch("/api/reviews/mine", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify({ action: "count" }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j && typeof j.pending === "number") setCounts(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [show]);

  if (!show || !counts || counts.pending === 0) return null;
  const late = counts.overdue > 0;
  return (
    <a href="/review" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3 shadow-sm"
      style={{ background: late ? "#fee2e2" : "#FAEEDA", color: late ? "#991b1b" : "#854F0B", border: `1px solid ${late ? "#fca5a5" : "#f2d3a0"}`, textDecoration: "none" }}>
      <span className="text-sm">
        <strong>📄 {counts.pending} document{counts.pending === 1 ? "" : "s"} waiting for your review</strong>
        {late && <> · <strong>{counts.overdue} past due</strong></>}
      </span>
      <span className="text-sm font-semibold underline">Review now →</span>
    </a>
  );
}
