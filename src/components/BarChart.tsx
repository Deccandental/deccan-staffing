"use client";

import { useState } from "react";

/**
 * Compact bar chart for the Overview & Trends page.
 *
 * Weekly mode plots one bar per calendar week using the LAST number entered
 * that week (never more often than weekly). Weeks with no entry stay as an
 * empty slot so the timeline stays honest. Monthly mode does the same by
 * month. Each bar carries its dollar figure above and its date below, and the
 * buttons switch the window (default 6 months).
 */

export interface BarPoint { date: string; value: number }
export interface BarOption { label: string; n: number }

export const WEEKLY_OPTIONS: BarOption[] = [{ label: "3M", n: 13 }, { label: "6M", n: 26 }, { label: "12M", n: 52 }];
export const MONTHLY_OPTIONS: BarOption[] = [{ label: "6M", n: 6 }, { label: "12M", n: 12 }, { label: "18M", n: 18 }];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(d: string): Date {
  return /^\d{4}-\d{2}(-\d{2})?$/.test(d) ? new Date((d.length === 7 ? d + "-01" : d) + "T00:00:00") : new Date(d);
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}
function money(v: number): string {
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 100000) return `${sign}$${Math.round(a / 1000)}k`;
  if (a >= 10000) return `${sign}$${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

interface Slot { value: number | null; dLabel: string }

function buildSlots(points: BarPoint[], mode: "week" | "month", n: number): Slot[] {
  const now = new Date();
  if (mode === "week") {
    const cur = weekStart(now);
    const byWeek = new Map<string, { t: number; value: number; label: string }>();
    for (const p of points) {
      const d = parse(p.date);
      const k = ymd(weekStart(d));
      const prev = byWeek.get(k);
      if (!prev || d.getTime() > prev.t) byWeek.set(k, { t: d.getTime(), value: p.value, label: `${d.getMonth() + 1}/${d.getDate()}` });
    }
    const slots: Slot[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const w = new Date(cur); w.setDate(w.getDate() - 7 * i);
      const hit = byWeek.get(ymd(w));
      slots.push({ value: hit ? hit.value : null, dLabel: hit ? hit.label : `${w.getMonth() + 1}/${w.getDate()}` });
    }
    return slots;
  }
  // Latest entry in each month wins (several entries in a month are common).
  const byMonth = new Map<string, { t: number; value: number }>();
  for (const p of points) {
    const k = p.date.slice(0, 7);
    const t = parse(p.date).getTime();
    const prev = byMonth.get(k);
    if (!prev || t >= prev.t) byMonth.set(k, { t, value: p.value });
  }
  const slots: Slot[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
    slots.push({ value: byMonth.has(k) ? byMonth.get(k)!.value : null, dLabel: m.getMonth() === 0 || i === n - 1 ? `${MONTHS[m.getMonth()]} ’${String(m.getFullYear()).slice(2)}` : MONTHS[m.getMonth()] });
  }
  return slots;
}

export interface BarSeries {
  label: string;               // toggle label, e.g. "Balance" / "Statement"
  mode: "week" | "month";
  points: BarPoint[];
  caption?: string;
}

/**
 * One or more series. With more than one, a small toggle (e.g. Balance /
 * Statement) switches between them; each series keeps its own time window.
 */
export default function BarChart({ series, height = 104 }: { series: BarSeries[]; height?: number }) {
  const [active, setActive] = useState(0);
  const [ns, setNs] = useState<Record<number, number>>({});
  const cur = series[Math.min(active, series.length - 1)];
  const opts = cur.mode === "week" ? WEEKLY_OPTIONS : MONTHLY_OPTIONS;
  const n = ns[active] ?? opts[1].n;
  const slots = buildSlots(cur.points, cur.mode, n);
  const maxAbs = Math.max(1, ...slots.map((s) => (s.value == null ? 0 : Math.abs(s.value)))) * 1.05;
  const step = n > 30 ? 2 : 1;
  const lastIdx = (() => { for (let i = slots.length - 1; i >= 0; i--) if (slots[i].value != null) return i; return -1; })();
  const pill = (on: boolean) => on
    ? { background: "#334155", color: "#fff", borderColor: "#334155" }
    : { background: "#fff", color: "#475569", borderColor: "#cbd5e1" };

  return (
    <div className="min-w-0 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {series.length > 1 && (
            <div className="flex items-center gap-1">
              {series.map((sr, i) => (
                <button key={sr.label} onClick={() => setActive(i)} aria-pressed={active === i}
                  className="rounded-md px-2.5 py-0.5 text-[11px] font-semibold border" style={pill(active === i)}>{sr.label}</button>
              ))}
            </div>
          )}
          <span className="text-xs text-slate-500">{cur.caption}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-400 mr-0.5">Show</span>
          {opts.map((o) => (
            <button key={o.label} onClick={() => setNs((m) => ({ ...m, [active]: o.n }))} aria-pressed={n === o.n}
              className="rounded-full px-2.5 py-0.5 text-[11px] border" style={pill(n === o.n)}>{o.label}</button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-[3px] border-b border-slate-300" style={{ height: height + 34, paddingTop: 4 }}>
        {slots.map((s, i) => {
          const fromEnd = slots.length - 1 - i;
          const labelled = fromEnd % step === 0;
          const isLast = i === lastIdx;
          const neg = s.value != null && s.value < 0;
          return (
            <div key={i} className="flex-1 min-w-0 flex flex-col justify-end items-stretch">
              {s.value != null && labelled && (
                <div className="flex justify-center" style={{ minHeight: 13 }}>
                  <span className="whitespace-nowrap" style={{ fontSize: 10, lineHeight: "13px", color: isLast ? "#c2410c" : "#475569", fontWeight: isLast ? 700 : 500 }}>{money(s.value)}</span>
                </div>
              )}
              {s.value != null && (
                <div style={{ height: Math.max(3, Math.round((Math.abs(s.value) / maxAbs) * height)), background: neg ? "#dc2626" : isLast ? "#e8622a" : "#64748b", borderRadius: "3px 3px 0 0", marginTop: 2 }}
                  title={`${s.dLabel}: ${s.value < 0 ? "−" : ""}$${Math.abs(Math.round(s.value)).toLocaleString("en-US")}`} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px]">
        {slots.map((s, i) => {
          const fromEnd = slots.length - 1 - i;
          return (
            <div key={i} className="flex-1 min-w-0 flex justify-center">
              <span className="whitespace-nowrap" style={{ fontSize: 10, lineHeight: "13px", color: s.value == null ? "#cbd5e1" : "#64748b" }}>{fromEnd % step === 0 ? s.dLabel : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
