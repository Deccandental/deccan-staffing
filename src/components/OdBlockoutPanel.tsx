"use client";

import { useEffect, useRef, useState } from "react";
import { sessionHeaders } from "@/lib/secureData";

// "Open Dental blockout" section of a day in the Schedule Builder: shows the
// Deccan App blockout exactly as it will appear in Open Dental, filled in
// from the day's plan, and lets an admin add lines or rewrite it. Saving
// sends it to Open Dental straight away.

interface DayInfo {
  ok: boolean;
  error?: string;
  hasBlock: boolean;
  canSave: boolean;
  configured: boolean;
  enabled: boolean;
  title: string;
  auto: string[];
  extraLines: string[];
  override: string[] | null;
  final: string[];
  status: { status: string; message: string | null; synced_at: string } | null;
  deletedInOd: boolean;
  inOd: { lines: string[]; start: string; stop: string } | null;
  odError: string | null;
  synced?: { status?: string; message?: string; skipped?: string } | null;
}

const PURPLE = "#c4b5fd";

async function call(body: Record<string, unknown>): Promise<DayInfo> {
  try {
    const res = await fetch("/api/opendental/day", { method: "POST", headers: sessionHeaders(), body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, error: "Network error." } as DayInfo;
  }
}

function Block({ lines, muted }: { lines: string[]; muted?: boolean }) {
  return (
    <div className="rounded-sm px-3 py-2 font-mono text-[12.5px] leading-5 whitespace-pre-wrap break-words"
      style={{ background: muted ? "#e5e7eb" : PURPLE, color: "#111" }}>
      {lines.length > 0 ? lines.join("\n") : "(empty)"}
    </div>
  );
}

export default function OdBlockoutPanel({ date, refreshKey, canEdit, onChanged }: { date: string; refreshKey: string; canEdit: boolean; onChanged?: () => void }) {
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [extra, setExtra] = useState("");
  const [overrideText, setOverrideText] = useState<string | null>(null); // null = automatic
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  function take(d: DayInfo, keepEdits = false) {
    setInfo(d);
    if (!d.ok || (keepEdits && dirtyRef.current)) return;
    setExtra(d.extraLines.join("\n"));
    setOverrideText(d.override ? d.override.filter((l) => l !== d.title).join("\n") : null);
    setDirty(false);
  }

  // Reload when the day changes, and shortly after the plan changes (saves and syncs settle first).
  useEffect(() => { setMsg(""); call({ date, action: "get" }).then((d) => take(d)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);
  useEffect(() => {
    const t = setTimeout(() => call({ date, action: "get" }).then((d) => take(d, true)), 1500);
    // Plan changes are sent to Open Dental a few seconds after saving; check back once that's done.
    const t2 = setTimeout(() => { call({ date, action: "get" }).then((d) => take(d, true)); onChanged?.(); }, 9000);
    return () => { clearTimeout(t); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setMsg("");
    const d = await call({ date, ...body });
    setBusy(false);
    if (!d.ok) { setMsg(d.error ?? "Something went wrong."); return; }
    take(d);
    onChanged?.();
    const s = d.synced;
    setMsg(s?.skipped ? `Saved. ${s.skipped}` : s?.status === "ok" ? "Saved and sent to Open Dental." : s?.message ? `Saved. ${s.message}` : "Saved.");
  }

  if (!info) return null;
  if (!info.ok) return <section className="rounded-2xl bg-white p-6 shadow text-sm text-red-500">{info.error}</section>;
  if (!info.hasBlock) return null;

  // What the block will say with the edits on screen (before saving).
  const draft = overrideText !== null
    ? [info.title, ...overrideText.split("\n").map((l) => l.trim()).filter(Boolean)]
    : [info.title, ...extra.split("\n").map((l) => l.trim()).filter(Boolean), ...info.auto];

  const st = info.status?.status;
  const editedThere = st === "edited_in_od";
  const showOd = info.inOd && (editedThere || info.inOd.lines.join("\n") !== info.final.join("\n"));

  return (
    <section className="rounded-2xl bg-white p-6 shadow">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="card-title">Open Dental blockout</h3>
        <span className="text-xs">
          {!info.configured ? <span className="text-slate-400">Preview — Open Dental isn&apos;t connected yet</span>
            : !info.enabled ? <span className="text-slate-400">Preview — sync is turned off</span>
            : st === "ok" ? <span className="text-green-600">✓ In Open Dental</span>
            : st === "edited_in_od" ? <span className="text-amber-700">Edited in Open Dental</span>
            : st === "deleted_in_od" || info.deletedInOd ? <span className="text-amber-700">Deleted in Open Dental</span>
            : st === "error" ? <span className="text-red-600">Not synced</span>
            : <span className="text-slate-400">Not sent yet</span>}
        </span>
      </div>

      <p className="text-xs text-slate-400 mb-2">
        Goes in the Notes column, just under your team&apos;s own note. {overrideText === null ? "Fills itself in from the plan above and updates as it changes." : "You're editing the whole text, so it won't update from the plan for this day."}
      </p>
      <Block lines={draft} />

      {canEdit && info.canSave && (
        <div className="mt-3 space-y-2">
          {overrideText === null ? (
            <>
              <label className="block text-xs font-medium text-slate-500">Add your own lines (shown at the top, kept as the plan changes)</label>
              <textarea value={extra} rows={2} placeholder="e.g. Dr. Chopra late start 9am"
                onChange={(e) => { setExtra(e.target.value); setDirty(true); }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none" />
            </>
          ) : (
            <>
              <label className="block text-xs font-medium text-slate-500">Whole text (the title line is added for you)</label>
              <textarea value={overrideText} rows={Math.min(18, Math.max(6, overrideText.split("\n").length + 1))}
                onChange={(e) => { setOverrideText(e.target.value); setDirty(true); }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none" />
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !dirty}
              onClick={() => act({ action: "save", extraLines: extra, override: overrideText === null ? null : overrideText })}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40" style={{ background: "#e8622a" }}>
              {busy ? "Saving…" : "Save"}
            </button>
            {overrideText === null ? (
              <button disabled={busy} onClick={() => { setOverrideText(draft.slice(1).join("\n")); setDirty(true); }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                Edit the whole text
              </button>
            ) : (
              <button disabled={busy}
                onClick={() => act({ action: "save", extraLines: extra, override: null }, "Go back to the automatic text for this day? Your edited text will be replaced.")}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                Back to automatic
              </button>
            )}
            {dirty && !busy && (
              <button onClick={() => take(info)} className="text-xs text-slate-400 hover:underline">Discard changes</button>
            )}
            {msg && <span className="text-xs text-slate-500">{msg}</span>}
          </div>
        </div>
      )}

      {info.status?.status === "error" && info.status.message && <p className="mt-3 text-xs text-red-600">{info.status.message}</p>}
      {info.odError && <p className="mt-3 text-xs text-red-600">{info.odError}</p>}

      {(info.deletedInOd || st === "deleted_in_od") && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Someone deleted this blockout in Open Dental, so it stays deleted for this day.
          {canEdit && (
            <button disabled={busy} onClick={() => act({ action: "useApp" })}
              className="ml-2 rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold hover:bg-amber-100">Put it back</button>
          )}
        </div>
      )}

      {showOd && info.inOd && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-500 mb-1">
            In Open Dental now{editedThere ? " — someone changed it there" : ""}:
          </p>
          <Block lines={info.inOd.lines} muted />
          {editedThere && info.status?.message && <p className="mt-1 text-xs text-amber-700">{info.status.message}</p>}
          {canEdit && editedThere && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button disabled={busy}
                onClick={() => act({ action: "useApp" }, "Replace the blockout in Open Dental with the app's version? Changes made there will be lost.")}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Keep the app&apos;s version
              </button>
              <button disabled={busy} onClick={() => act({ action: "useOd" })}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Keep Open Dental&apos;s version
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
