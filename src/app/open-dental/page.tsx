"use client";

import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate from "@/components/AppIdentityGate";
import AccessDenied from "@/components/AccessDenied";
import { sessionHeaders } from "@/lib/secureData";
import { syncOdNow } from "@/lib/openDental/clientSync";
import { todayStr } from "@/lib/today";

interface Settings {
  enabled: boolean;
  notesOperatoryNum: number | null;
  staffBlockoutType: number | null;
  providerBlockoutType: number | null;
  dayStart: string;
  midday: string;
  dayEnd: string;
  rowMinutes: number;
  daysAhead: number;
}
interface StaffRow { id: number; name: string; role: string; displayName: string; defaultDisplayName: string; provNum: number | null; operatoryNums: number[] }
interface SetupData {
  configured: boolean;
  odError: string | null;
  od: { providers: { provNum: number; abbr: string; name: string }[]; operatories: { operatoryNum: number; name: string; abbrev: string }[]; blockoutTypes: { defNum: number; name: string }[] } | null;
  settings: Settings;
  staff: StaffRow[];
  problemDays: { date: string; status: string; message: string | null }[];
  lastSyncedAt: string | null;
}
interface Preview { isOpen: boolean; staffLines: string[]; blockouts: { kind: string; start: string; stop: string; operatoryNums: number[]; note: string }[] }

const ORANGE = "#e8622a";
const STATUS_LABEL: Record<string, string> = { edited_in_od: "Edited in Open Dental. ", deleted_in_od: "Deleted in Open Dental. ", skipped_manual: "Typed by hand. ", error: "" };
const PROVIDER_ROLES = new Set(["Dentist", "Hygienist"]);
const ROLE_ORDER = ["Dentist", "Hygienist", "RDA", "Assistant", "Front Desk"];

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow">
      <h2 className="card-title">{title}</h2>
      {sub && <p className="text-sm text-slate-400 mt-1 mb-4">{sub}</p>}
      {!sub && <div className="mb-4" />}
      {children}
    </section>
  );
}

function OpenDentalPageBody() {
  const [data, setData] = useState<SetupData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [previewDate, setPreviewDate] = useState(todayStr());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const [forcing, setForcing] = useState<string | null>(null);

  async function useAppVersion(date: string, status: string) {
    const what = status === "deleted_in_od" ? "put the Deccan App blockout back on" : "replace the Deccan App blockout on";
    if (!confirm(`This will ${what} ${date} in Open Dental, exactly as the staffing app has it. Anything typed into that note in Open Dental will be lost. Continue?`)) return;
    setForcing(date);
    const r = await syncOdNow({ from: date, to: date, force: true });
    if (!r.ok) alert(r.errors?.[0]?.message ?? r.error ?? r.skipped ?? "Couldn't update Open Dental.");
    setForcing(null);
    load();
  }

  async function load() {
    try {
      const res = await fetch("/api/opendental/setup", { headers: sessionHeaders() });
      const json = await res.json();
      if (!json.ok) { setLoadError(json.error ?? "Couldn't load."); return; }
      setData(json);
      setSettings(json.settings);
      setRows(json.staff);
    } catch { setLoadError("Couldn't load."); }
  }
  useEffect(() => { load(); }, []);

  async function runPreview(date: string) {
    setPreviewErr("");
    try {
      const res = await fetch("/api/opendental/preview", { method: "POST", headers: sessionHeaders(), body: JSON.stringify({ date }) });
      const json = await res.json();
      if (json.ok) setPreview(json); else { setPreview(null); setPreviewErr(json.error ?? "Preview failed."); }
    } catch { setPreviewErr("Preview failed."); }
  }
  useEffect(() => { if (previewDate) runPreview(previewDate); }, [previewDate]);

  const sortedRows = useMemo(() => [...rows].sort((a, b) =>
    (ROLE_ORDER.indexOf(a.role) + 99) % 99 - (ROLE_ORDER.indexOf(b.role) + 99) % 99 || a.name.localeCompare(b.name)), [rows]);

  // Columns are shown by the name given to them in Open Dental (its short abbreviation is only a fallback).
  const opName = (n: number) => { const o = data?.od?.operatories.find((x) => x.operatoryNum === n); return o?.name || o?.abbrev || `#${n}`; };

  function setRow(id: number, patch: Partial<StaffRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/opendental/setup", {
        method: "POST", headers: sessionHeaders(),
        body: JSON.stringify({ settings, links: rows.map((r) => ({ employeeId: r.id, displayName: r.displayName, provNum: r.provNum, operatoryNums: r.operatoryNums })) }),
      });
      const json = await res.json();
      setMsg(json.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: json.error ?? "Couldn't save." });
      if (json.ok) { await load(); runPreview(previewDate); }
    } catch { setMsg({ kind: "err", text: "Couldn't save." }); }
    setSaving(false);
  }

  async function syncAll() {
    setSyncing(true);
    setSyncMsg("");
    const r = await syncOdNow({ all: true });
    setSyncMsg(r.skipped ? r.skipped : r.ok ? `Done — ${r.changes ?? 0} change${r.changes === 1 ? "" : "s"} made in Open Dental.` : `Some days failed: ${r.errors?.[0]?.message ?? r.error ?? "unknown error"}`);
    setSyncing(false);
    load();
  }

  if (loadError) return <Shell><p className="text-red-500">{loadError}</p></Shell>;
  if (!data || !settings) return <Shell><p className="text-slate-400">Loading…</p></Shell>;

  const od = data.od;
  const numSelect = (value: number | null, onChange: (v: number | null) => void, options: { value: number; label: string }[], placeholder: string) => (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" disabled={!od}>
      <option value="">{od ? placeholder : "Available once Open Dental is connected"}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {value != null && !options.some((o) => o.value === value) && <option value={value}>#{value}</option>}
    </select>
  );

  return (
    <Shell>
      <div className="grid gap-6 xl:grid-cols-2 max-w-7xl">
        <div className="space-y-6">
          <Card title="Connection">
            {!data.configured ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                The Open Dental keys haven&apos;t been added yet. Everything on this page can be set up now, and the preview works,
                but nothing is sent to Open Dental until the developer and customer keys are added to the app&apos;s server settings.
              </div>
            ) : data.odError ? (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{data.odError}</div>
            ) : (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
                ✓ Connected to Open Dental — {od?.providers.length ?? 0} providers, {od?.operatories.length ?? 0} columns.
              </div>
            )}
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
              Sync to Open Dental is <b>{settings.enabled ? "on" : "off"}</b>
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button onClick={syncAll} disabled={syncing || !data.configured || !data.settings.enabled}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-gray-50 disabled:opacity-40">
                {syncing ? "Syncing…" : `↻ Sync the next ${data.settings.daysAhead} days now`}
              </button>
              {data.lastSyncedAt && <span className="text-xs text-slate-400">Last sync {new Date(data.lastSyncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
            </div>
            {syncMsg && <p className="mt-2 text-sm text-slate-500">{syncMsg}</p>}
            {data.problemDays.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Days that need attention</p>
                {data.problemDays.map((d) => (
                  <div key={d.date} className={`rounded-lg px-3 py-2 text-xs ${d.status === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
                    <b>{new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</b>
                    {" — "}{STATUS_LABEL[d.status] ?? ""}{d.message}
                    {(d.status === "edited_in_od" || d.status === "deleted_in_od") && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <button onClick={() => { setPreviewDate(d.date); }} className="rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold hover:bg-amber-100">
                          Preview the app&apos;s version
                        </button>
                        <button onClick={() => useAppVersion(d.date, d.status)} disabled={forcing === d.date}
                          className="rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold hover:bg-amber-100 disabled:opacity-50">
                          {forcing === d.date ? "Updating…" : d.status === "deleted_in_od" ? "Put the app's note back" : "Use the staffing app's version"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Where the blockouts go" sub="The Deccan App blockout goes in the Notes column, just under your team's own Staff Schedules note (which the app never touches), or at the top of the day when there isn't one. When a linked doctor or hygienist is out, their own columns are blocked so patients can't be booked with them.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Notes column</label>
                {numSelect(settings.notesOperatoryNum, (v) => setSettings({ ...settings, notesOperatoryNum: v }),
                  (od?.operatories ?? []).map((o) => ({ value: o.operatoryNum, label: o.name })), "Choose a column")}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Blockout type for the Deccan App blockout</label>
                {numSelect(settings.staffBlockoutType, (v) => setSettings({ ...settings, staffBlockoutType: v }),
                  (od?.blockoutTypes ?? []).map((b) => ({ value: b.defNum, label: b.name })), "Choose a type")}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Blockout type when a provider is out</label>
                {numSelect(settings.providerBlockoutType, (v) => setSettings({ ...settings, providerBlockoutType: v }),
                  (od?.blockoutTypes ?? []).map((b) => ({ value: b.defNum, label: b.name })), "Choose a type")}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Keep this far ahead in Open Dental</label>
                <select value={settings.daysAhead} onChange={(e) => setSettings({ ...settings, daysAhead: Number(e.target.value) })}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white">
                  {[[14, "2 weeks"], [30, "30 days"], [60, "60 days"], [90, "90 days"], [120, "120 days"]].map(([n, label]) => (
                    <option key={n} value={n}>{label}</option>
                  ))}
                  {![14, 30, 60, 90, 120].includes(settings.daysAhead) && <option value={settings.daysAhead}>{settings.daysAhead} days</option>}
                </select>
                <p className="text-xs text-slate-400 mt-1">The nightly update keeps this far ahead in Open Dental.</p>
              </div>
            </div>
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 mt-4">
              {([["dayStart", "Day starts"], ["midday", "Midday"], ["dayEnd", "Day ends"]] as const).map(([k, label]) => (
                <div key={k}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                  <input type="time" value={settings[k]} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Minutes per row</label>
                <input type="number" min={5} max={60} step={5} value={settings.rowMinutes}
                  onChange={(e) => setSettings({ ...settings, rowMinutes: Number(e.target.value) })}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Create a blockout type in Open Dental just for this (e.g. &ldquo;Deccan App&rdquo;) and give it its own colour, so it stands out. The block gets one row per line. Half-day leave blocks from the day start to midday, or midday to the day end.
            </p>
          </Card>

          <Card title="Preview" sub="What the app would put in Open Dental for a day. Nothing is sent from here.">
            <input type="date" value={previewDate} onChange={(e) => setPreviewDate(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm mb-4" />
            {previewErr && <p className="text-sm text-red-500">{previewErr}</p>}
            {preview && !preview.isOpen && <p className="text-sm text-slate-400">The office is closed that day (not a holiday), so there&apos;s no blockout.</p>}
            {preview && preview.isOpen && (
              <div className="flex flex-wrap gap-4 items-start">
                <div className="rounded-sm px-3 py-2 font-mono text-[13px] leading-5 min-w-[240px]" style={{ background: "#c4b5fd", color: "#111" }}>
                  {preview.staffLines.length > 0 ? preview.staffLines.map((l, i) => <div key={i}>{l}</div>) : <div>(nothing to show)</div>}
                </div>
                <div className="space-y-2 text-xs text-slate-500">
                  {preview.blockouts.length === 0 && <p>Pick the Notes column and blockout types above to see the exact blockouts.</p>}
                  {preview.blockouts.map((b, i) => (
                    <p key={i}>
                      <b>{b.kind === "staff" ? "Deccan App" : "Provider out"}</b> · {b.start}–{b.stop} · {b.operatoryNums.map(opName).join(", ")}
                      {b.kind === "provider" && <><br />{b.note}</>}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        <Card title="Staff in Open Dental" sub="How each person appears in the Deccan App blockout (doctors by initials, everyone else by first name — change any you like). Link doctors and hygienists to their Open Dental provider and pick the columns to block when they're out.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400 border-b">
                  <th className="py-2 pr-3">Staff member</th>
                  <th className="py-2 pr-3">Shown as</th>
                  <th className="py-2 pr-3">Open Dental provider</th>
                  <th className="py-2">Columns to block</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-600">{r.name}</div>
                      <div className="text-xs text-slate-400">{r.role}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <input value={r.displayName} placeholder={r.defaultDisplayName} maxLength={30}
                        onChange={(e) => setRow(r.id, { displayName: e.target.value.toUpperCase() })}
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm uppercase" />
                    </td>
                    <td className="py-2 pr-3">
                      {PROVIDER_ROLES.has(r.role) ? (
                        <select value={r.provNum ?? ""} disabled={!od}
                          onChange={(e) => setRow(r.id, { provNum: e.target.value === "" ? null : Number(e.target.value) })}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-sm bg-white max-w-[180px]">
                          <option value="">{od ? "Not linked" : "—"}</option>
                          {(od?.providers ?? []).map((p) => <option key={p.provNum} value={p.provNum}>{p.abbr} · {p.name}</option>)}
                          {r.provNum != null && !od?.providers.some((p) => p.provNum === r.provNum) && <option value={r.provNum}>#{r.provNum}</option>}
                        </select>
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="py-2">
                      {PROVIDER_ROLES.has(r.role) && od ? (
                        <div className="flex flex-wrap gap-1 max-w-[260px]">
                          {od.operatories.filter((o) => o.operatoryNum !== settings.notesOperatoryNum).map((o) => {
                            const on = r.operatoryNums.includes(o.operatoryNum);
                            return (
                              <button key={o.operatoryNum} type="button" title={o.abbrev ? `${o.name} (${o.abbrev})` : o.name}
                                onClick={() => setRow(r.id, { operatoryNums: on ? r.operatoryNums.filter((n) => n !== o.operatoryNum) : [...r.operatoryNums, o.operatoryNum] })}
                                className="rounded-full px-2 py-0.5 text-xs border transition"
                                style={on ? { background: ORANGE, color: "white", borderColor: ORANGE } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}>
                                {o.name || o.abbrev}
                              </button>
                            );
                          })}
                        </div>
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 bg-transparent py-3">
        <button onClick={save} disabled={saving}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow hover:opacity-90 disabled:opacity-50" style={{ background: ORANGE }}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className={`text-sm ${msg.kind === "ok" ? "text-green-600" : "text-red-500"}`}>{msg.text}</span>}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell">
      <Sidebar />
      <div className="app-content">
        <div className="mb-8">
          <h1 className="page-title">Open Dental</h1>
          <p className="page-subtitle">Put approved leave and the day&apos;s staff assignments on the Open Dental schedule</p>
        </div>
        {children}
      </div>
    </main>
  );
}

export default function OpenDentalPage() {
  return (
    <AppIdentityGate>
      {(identity, logout) => identity.canAdmin ? <OpenDentalPageBody /> : <AccessDenied logout={logout} />}
    </AppIdentityGate>
  );
}
