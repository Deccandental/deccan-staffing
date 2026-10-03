"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Compact history viewer for the Cash Flow "Weekly Update" tab.
 *
 * Every figure entered on that tab is logged somewhere (balance checks,
 * statement entries, weekly reviews, A/R aging). This renders any of those
 * logs as single-line rows so an entry can be reviewed — or a bad one
 * removed — without leaving the page.
 */

export interface HistRow {
  id: string;
  label: string;            // left side — usually a date
  value: string;            // right side — the figure(s), kept to one line
  // Statement rows only: the month the statement covers. When onMonth is
  // supplied the label becomes a dropdown so a mislabelled entry can be
  // moved to the right month.
  month?: string;
  onMonth?: (newMonth: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export interface HistColumn {
  title: string;
  load: () => Promise<HistRow[]>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" → "Sep ’26" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
}

/** Last `back` months through `forward` months ahead, newest first, as YYYY-MM. */
export function monthOptions(back = 18, forward = 1, extra: string[] = []): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = -forward; i <= back; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  for (const e of extra) if (!out.includes(e)) out.push(e);
  return out.sort().reverse();
}

export function MonthSelect({ value, onChange, className = "", extra = [] }: {
  value: string; onChange: (v: string) => void; className?: string; extra?: string[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className={`rounded border border-slate-200 bg-white px-1 py-1 text-xs focus:outline-none ${className}`}>
      {monthOptions(18, 1, [value, ...extra]).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
    </select>
  );
}

function Column({ col, onChanged }: { col: HistColumn; onChanged?: () => void }) {
  const [rows, setRows] = useState<HistRow[] | null>(null);
  // The parent builds the column objects inline, so keep the latest loader in
  // a ref and fetch once on open rather than on every parent re-render.
  const loader = useRef(col.load);
  loader.current = col.load;
  async function load() { setRows(await loader.current()); }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-w-0 flex-1" style={{ minWidth: 220 }}>
      <p className="text-[11px] font-semibold text-slate-400 mb-0.5">{col.title}</p>
      <div className="max-h-44 overflow-y-auto">
        {rows === null ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-400">No entries yet.</p>
        ) : rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs leading-5 border-b border-slate-100 last:border-0 whitespace-nowrap">
            {r.onMonth && r.month ? (
              <MonthSelect value={r.month} className="!py-0 !px-0.5 text-[11px]"
                onChange={async (m) => { if (m !== r.month) { await r.onMonth!(m); await load(); onChanged?.(); } }} />
            ) : (
              <span className="text-slate-500 w-24 shrink-0">{r.label}</span>
            )}
            <span className="font-semibold text-slate-700 truncate flex-1">{r.value}</span>
            {r.onDelete && (
              <button title="Delete this entry"
                onClick={async () => {
                  if (!confirm("Delete this entry? This can't be undone.")) return;
                  await r.onDelete!(); await load(); onChanged?.();
                }}
                className="text-red-400 hover:text-red-600 shrink-0">✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The expanded panel — render it under a row when its History button is on. */
export function HistoryBlock({ columns, onChanged }: { columns: HistColumn[]; onChanged?: () => void }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-slate-50 px-3 py-2">
      {columns.map((c, i) => <Column key={`${c.title}-${i}`} col={c} onChanged={onChanged} />)}
    </div>
  );
}

/** Small text button that flips between "History" and "Hide". */
export function HistoryButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-xs text-orange-500 hover:underline whitespace-nowrap">
      {open ? "Hide" : "History"}
    </button>
  );
}

/**
 * Number input that shows its unit inside the box: "$" by default, or pass
 * prefix="" suffix="%" for a rate. Everything else is a normal <input>.
 */
export function NumInput({ prefix = "$", suffix = "", wrap = "w-full", className = "", style, ...rest }:
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "prefix"> & { prefix?: string; suffix?: string; wrap?: string }) {
  return (
    <span className={`relative inline-block ${wrap}`}>
      {prefix && <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">{prefix}</span>}
      <input {...rest} type="number" className={className}
        style={{ ...style, paddingLeft: prefix ? 16 : undefined, paddingRight: suffix ? 16 : undefined }} />
      {suffix && <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">{suffix}</span>}
    </span>
  );
}

// ---------------- "Updated …" stamps with overdue warnings ----------------

export const UPDATED_COLOR = "#1e4e8c";   // dark blue — as strong as the card headings, a different hue
export const WARN_COLOR = "#b91c1c";

function parseWhen(when: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(when) ? new Date(when + "T00:00:00") : new Date(when);
}

export function daysAgo(when: string | null | undefined): number {
  if (!when) return Infinity;
  return (Date.now() - parseWhen(when).getTime()) / 86400000;
}

export function fmtWhen(when: string): string {
  const d = parseWhen(when);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "2-digit" });
}

/**
 * "Updated Oct 2" in dark blue; turns red with a ⚠️ (and the reasons on hover)
 * when something on that line is overdue.
 */
export function UpdatedStamp({ when, warnings = [], prefix = "Updated " }: { when: string | null | undefined; warnings?: string[]; prefix?: string }) {
  const warn = warnings.length > 0;
  return (
    <span className="text-xs font-medium whitespace-nowrap" style={{ color: warn ? WARN_COLOR : UPDATED_COLOR }}
      title={warn ? warnings.join("\n") : when ? `Last updated ${parseWhen(when).toLocaleString("en-US", { dateStyle: "medium" })}` : undefined}>
      {warn ? "⚠️ " : ""}{when ? `${prefix}${fmtWhen(when)}` : "Never entered"}
    </span>
  );
}
