"use client";

import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";

interface Props {
  year: number;
  month: number;
  schedule: Record<string, { dentists: string[] }>;
}

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PrintSchedule({ year, month, schedule }: Props) {
  async function handlePrint() {
    const staff: Employee[] = await loadStaff();
    const days = generateMonth(year, month);
    const firstDow = new Date(year, month - 1, 1).getDay();

    const blanks = Array.from({ length: firstDow }).map(() => null);
    const allCells = [...blanks, ...days];
    while (allCells.length % 7 !== 0) allCells.push(null);

    function buildCell(day: typeof days[0] | null): string {
      if (!day) return `<td class="empty-cell"></td>`;
      if (!day.isOpen) {
        return `<td class="day-cell closed">
          <div class="day-number">${day.day}</div>
          <div class="closed-label">${day.weekday === "Tue" ? "Closed" : "Weekend"}</div>
        </td>`;
      }
      const daySched = schedule[day.date];
      if (!daySched || daySched.dentists.length === 0) {
        return `<td class="day-cell open empty">
          <div class="day-number">${day.day}</div>
          <div class="not-set">Not scheduled</div>
        </td>`;
      }
      const assignments = buildDailyAssignments(staff, daySched.dentists, day.date);
      const hasWarning = assignments.warnings.length > 0;
      const pairings = assignments.dentists.map(({ dentist, assistant }) =>
        `<div class="pairing">
          <span class="dot" style="background:${dentist.color}"></span>
          <span class="dentist-name">${dentist.name.replace("Dr. ", "Dr.")}</span>
          <span class="separator">/</span>
          <span class="assistant-name">${assistant?.name.split(" ")[0] ?? "—"}</span>
        </div>`
      ).join("");
      const fd = assignments.frontDesk.map((e) => e.name.split(" ")[0]).join(", ") || "—";
      const hy = assignments.hygienists.map((e) => e.name.split(" ")[0]).join(", ") || "—";
      return `<td class="day-cell open ${hasWarning ? "has-warning" : "complete"}">
        <div class="day-number ${hasWarning ? "warning-num" : ""}">${day.day}</div>
        <div class="pairings">${pairings}</div>
        <div class="support-row"><span class="support-label">FD:</span> ${fd}</div>
        <div class="support-row"><span class="support-label">Hyg:</span> ${hy}</div>
        ${hasWarning ? `<div class="warning-badge">⚠ ${assignments.warnings[0].message}</div>` : ""}
      </td>`;
    }

    const weeks: (typeof days[0] | null)[][] = [];
    for (let i = 0; i < allCells.length; i += 7) weeks.push(allCells.slice(i, i + 7));
    const tableRows = weeks.map((week) => `<tr>${week.map(buildCell).join("")}</tr>`).join("");

    const html = `<!DOCTYPE html><html><head>
      <title>Deccan Dental — ${formatMonthYear(year, month)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #1e293b; padding: 16px; }
        h1 { font-size: 18px; font-weight: bold; margin-bottom: 2px; }
        .subtitle { color: #64748b; font-size: 11px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .header-row th { background: #f1f5f9; padding: 6px 4px; text-align: center; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border: 1px solid #e2e8f0; }
        .day-cell { border: 1px solid #e2e8f0; vertical-align: top; padding: 6px; height: 110px; }
        .empty-cell { border: 1px solid #f1f5f9; background: #fafafa; }
        .day-cell.closed { background: #f8fafc; }
        .day-cell.open.empty { background: #fff; }
        .day-cell.complete { background: #f0fdf4; }
        .day-cell.has-warning { background: #fffbeb; }
        .day-number { font-weight: 700; font-size: 13px; color: #1e293b; margin-bottom: 4px; }
        .warning-num { color: #d97706; }
        .closed-label { font-size: 9px; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.05em; }
        .not-set { font-size: 9px; color: #cbd5e1; font-style: italic; margin-top: 4px; }
        .pairings { margin-bottom: 4px; }
        .pairing { display: flex; align-items: center; gap: 2px; margin-bottom: 2px; font-size: 9.5px; line-height: 1.3; }
        .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .dentist-name { font-weight: 600; }
        .separator { color: #94a3b8; margin: 0 1px; }
        .assistant-name { color: #475569; }
        .support-row { font-size: 9px; color: #475569; margin-top: 1px; }
        .support-label { font-weight: 700; color: #94a3b8; }
        .warning-badge { margin-top: 3px; font-size: 8px; color: #d97706; background: #fef3c7; border-radius: 3px; padding: 1px 3px; }
        .legend { display: flex; gap: 16px; margin-bottom: 10px; font-size: 10px; color: #64748b; }
        .legend-item { display: flex; align-items: center; gap: 4px; }
        .legend-dot { width: 10px; height: 10px; border-radius: 2px; }
        @media print { body { padding: 8px; } @page { margin: 0.5cm; size: landscape; } }
      </style>
    </head><body>
      <h1>Deccan Dental — ${formatMonthYear(year, month)}</h1>
      <p class="subtitle">Printed ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · FD = Front Desk · Hyg = Hygienist</p>
      <div class="legend">
        <div class="legend-item"><div class="legend-dot" style="background:#bbf7d0;border:1px solid #86efac"></div> Fully staffed</div>
        <div class="legend-item"><div class="legend-dot" style="background:#fef3c7;border:1px solid #fde68a"></div> Has warning</div>
        <div class="legend-item"><div class="legend-dot" style="background:#f8fafc;border:1px solid #e2e8f0"></div> Closed / Weekend</div>
      </div>
      <table>
        <thead><tr class="header-row">${DAY_HEADERS.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </body></html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  return (
    <button
      onClick={handlePrint}
      className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold shadow hover:bg-slate-50 transition border border-slate-200"
    >
      🖨️ Print Calendar
    </button>
  );
}
