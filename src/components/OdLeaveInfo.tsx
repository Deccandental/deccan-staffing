"use client";

import { useEffect, useState } from "react";
import { sessionHeaders } from "@/lib/secureData";
import { syncOdNow } from "@/lib/openDental/clientSync";

// Shown when a leave request is opened on Manage Leave:
//  - patients already booked with this doctor/hygienist on those days, and
//  - whether approved leave has reached the Open Dental schedule (with Retry).
// Shows nothing at all until Open Dental is set up.

interface Info {
  ok: boolean;
  configured: boolean;
  enabled: boolean;
  isProvider: boolean;
  booked: { date: string; count: number }[] | null;
  bookedError: string | null;
  sync: { state: "synced" | "pending" | "error" | "attention" | "off"; message?: string };
}

const fmt = (ymd: string) => new Date(ymd + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export default function OdLeaveInfo({ requestId, startDate, endDate, status }: { requestId: string; startDate: string; endDate: string; status: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/opendental/leave-info", { method: "POST", headers: sessionHeaders(), body: JSON.stringify({ requestId }) });
      const json = await res.json();
      setInfo(json.ok ? json : null);
    } catch { setInfo(null); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [requestId, status, startDate, endDate]);

  async function retry() {
    setRetrying(true);
    setRetryMsg("");
    const r = await syncOdNow({ from: startDate, to: endDate });
    setRetryMsg(r.ok ? "Open Dental is up to date." : r.skipped ?? r.errors?.[0]?.message ?? r.error ?? "Sync failed.");
    setRetrying(false);
    await load();
  }

  if (!info || !info.configured) return null;

  const totalBooked = (info.booked ?? []).reduce((n, b) => n + b.count, 0);

  return (
    <div className="mb-3 rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Open Dental</div>

      {info.isProvider && (status === "pending" || status === "approved") && (
        info.bookedError ? (
          <div className="text-gray-500">Couldn&apos;t check booked patients: {info.bookedError}</div>
        ) : totalBooked === 0 ? (
          <div className="text-gray-500">No patients booked with them on these days.</div>
        ) : (
          <div style={{ color: "#b45309" }}>
            <span className="font-semibold">{totalBooked} patient{totalBooked !== 1 ? "s" : ""} booked</span> with them on these days:{" "}
            {(info.booked ?? []).map((b) => `${fmt(b.date)} (${b.count})`).join(", ")}
          </div>
        )
      )}
      {!info.isProvider && status === "pending" && (
        <div className="text-gray-500">Not linked to an Open Dental provider, so there are no patients to check. Approved leave is listed in the Staff Schedules note.</div>
      )}

      {status === "approved" && info.enabled && (
        <div className="flex flex-wrap items-center gap-2">
          {info.sync.state === "synced" && <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">✓ On the Open Dental schedule</span>}
          {info.sync.state === "pending" && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Not yet synced to Open Dental</span>}
          {info.sync.state === "error" && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Open Dental sync failed</span>}
          {info.sync.state === "attention" && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Check the Open Dental page</span>}
          {info.sync.message && <span className="text-xs text-gray-400">{info.sync.message}</span>}
          {(info.sync.state === "pending" || info.sync.state === "error") && (
            <button onClick={retry} disabled={retrying}
              className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50">
              {retrying ? "Syncing…" : "↻ Retry"}
            </button>
          )}
          {retryMsg && <span className="text-xs text-gray-500">{retryMsg}</span>}
        </div>
      )}
    </div>
  );
}
