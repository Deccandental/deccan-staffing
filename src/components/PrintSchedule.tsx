"use client";

import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { loadStaff } from "@/lib/staffStore";
import { loadHolidays } from "@/lib/holidays";
import { getOpenTuesdays } from "@/lib/openTuesdays";
import { getTempAssignmentsForMonth } from "@/lib/tempAssignments";
import { supabase } from "@/lib/supabase";
import { MonthSchedule } from "@/lib/scheduleStore";

interface Props {
  year: number;
  month: number;
  schedule: MonthSchedule;
}

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PrintSchedule({ year, month, schedule }: Props) {
  async function handlePrint() {
    const [staff, holidays, openTuesdays, tempAssignmentsList] = await Promise.all([
      loadStaff(),
      loadHolidays(),
      getOpenTuesdays(),
      getTempAssignmentsForMonth(year, month),
    ]);

    // Load temps
    const { data: tempsData } = await supabase.from("temps").select("*");
    const temps = tempsData ?? [];

    // Group temp assignments by date
    const tempsByDate: Record<string, { tempId: string; role: string }[]> = {};
    for (const ta of tempAssignmentsList) {
      if (!tempsByDate[ta.date]) tempsByDate[ta.date] = [];
      tempsByDate[ta.date].push({ tempId: ta.tempId, role: ta.role });
    }

    const days = generateMonth(year, month, openTuesdays, holidays);
    const firstDow = new Date(year, month - 1, 1).getDay();
    const blanks = Array.from({ length: firstDow }).map(() => null);
    const allCells = [...blanks, ...days];
    while (allCells.length % 7 !== 0) allCells.push(null);

    function buildCell(day: typeof days[0] | null): string {
      if (!day) return `<td class="empty-cell"></td>`;

      if (!day.isOpen) {
        return `
          <td class="day-cell closed">
            <div class="day-number">${day.day}</div>
            <div class="closed-label">${day.isHoliday ? day.holidayName : day.weekday === "Tue" ? "Closed" : "Weekend"}</div>
          </td>`;
      }

      const daySched = schedule[day.date];
      if (!daySched || daySched.dentists.length === 0) {
        return `
          <td class="day-cell open empty">
            <div class="day-number">${day.day}</div>
            <div class="not-set">Not scheduled</div>
          </td>`;
      }

      const assignments = buildDailyAssignments(
        staff, daySched.dentists, day.date, {}, [],
        day.isTuesday && day.isOpenTuesday,
        daySched.frontDeskRequired ?? 2,
        daySched.hygienistsRequired ?? 1
      );

      // Apply assistant overrides
      const ao = daySched.assistantOverrides ?? {};
      const resolvedDentists = assignments.dentists.map(({ dentist, assistant }) => {
        if (dentist.id in ao) {
          const ovId = ao[dentist.id];
          const overriddenAssistant = ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
          return { dentist, assistant: overriddenAssistant };
        }
        return { dentist, assistant };
      });

      const hasWarning = assignments.warnings.length > 0;

      const pairings = resolvedDentists.map(({ dentist, assistant }) =>
        `<div class="pairing">
          <span class="dot" style="background:${dentist.color}"></span>
          <span class="dentist-name">${dentist.name.replace("Dr. ", "Dr.")}</span>
          <span class="separator">/</span>
          <span class="assistant-name">${assistant?.name.split(" ")[0] ?? "—"}</span>
        </div>`
      ).join("");

      // Get temp assignments for this day
      const dayTemps = tempsByDate[day.date] ?? [];
      const tempFD = dayTemps.filter((t) => t.role === "Front Desk").map((t) => {
        const temp = temps.find((tm) => tm.id === t.tempId);
        return temp ? `${temp.name.split(" ")[0]}*` : "Temp*";
      });
      const tempHyg = dayTemps.filter((t) => t.role === "Hygienist").map((t) => {
        const temp = temps.find((tm) => tm.id === t.tempId);
        return temp ? `${temp.name.split(" ")[0]}*` : "Temp*";
      });
      const tempAsst = dayTemps.filter((t) => t.role === "Assistant" || t.role === "RDA").map((t) => {
        const temp = temps.find((tm) => tm.id === t.tempId);
        return temp ? `${temp.name.split(" ")[0]}*` : "Temp*";
      });

      const fdNames = [...assignments.frontDesk.map((e) => e.name.split(" ")[0]), ...tempFD].join(", ") || "—";
      const hygNames = [...assignments.hygienists.map((e) => e.name.split(" ")[0]), ...tempHyg].join(", ") || "—";
      const asstTempStr = tempAsst.length > 0 ? `<div class="support-row"><span class="support-label">Temp:</span> ${tempAsst.join(", ")}</div>` : "";

      return `
        <td class="day-cell open ${hasWarning ? "has-warning" : "complete"}">
          <div class="day-number ${hasWarning ? "warning-num" : ""}">${day.day}${day.isTuesday ? ' <span class="tue-badge">Tue</span>' : ""}</div>
          <div class="pairings">${pairings}</div>
          ${asstTempStr}
          <div class="support-row">
            <span class="support-label">FD:</span> ${fdNames}
          </div>
          <div class="support-row">
            <span class="support-label">Hyg:</span> ${hygNames}
          </div>
          ${hasWarning ? `<div class="warning-badge">⚠ ${assignments.warnings[0].message}</div>` : ""}
        </td>`;
    }

    const weeks: (typeof days[0] | null)[][] = [];
    for (let i = 0; i < allCells.length; i += 7) {
      weeks.push(allCells.slice(i, i + 7));
    }

    const tableRows = weeks.map((week) =>
      `<tr>${week.map(buildCell).join("")}</tr>`
    ).join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Deccan Dental — ${formatMonthYear(year, month)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; font-size: 11px; color: #1e293b; padding: 16px; }
          h1 { font-size: 18px; font-weight: bold; margin-bottom: 2px; }
          .subtitle { color: #64748b; font-size: 11px; margin-bottom: 12px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .header-row th {
            background: #f1f5f9; padding: 6px 4px; text-align: center;
            font-size: 10px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.05em; color: #64748b; border: 1px solid #e2e8f0;
          }
          .day-cell {
            border: 1px solid #e2e8f0; vertical-align: top; padding: 6px; height: 110px;
          }
          .empty-cell { border: 1px solid #f8fafc; background: #fafafa; }
          .closed { background: #f8fafc; }
          .complete { background: #f0fdf4; }
          .has-warning { background: #fffbeb; }
          .empty { background: #f8fafc; }
          .day-number {
            font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 4px;
          }
          .warning-num { color: #d97706; }
          .closed-label { font-size: 9px; color: #94a3b8; font-style: italic; }
          .not-set { font-size: 9px; color: #cbd5e1; font-style: italic; }
          .pairings { margin-bottom: 3px; }
          .pairing {
            display: flex; align-items: center; gap: 2px;
            font-size: 9px; margin-bottom: 2px;
          }
          .dot {
            display: inline-block; width: 6px; height: 6px;
            border-radius: 50%; flex-shrink: 0;
          }
          .dentist-name { font-weight: 600; }
          .separator { color: #94a3b8; margin: 0 1px; }
          .assistant-name { color: #475569; }
          .support-row { font-size: 9px; color: #475569; margin-top: 1px; }
          .support-label { font-weight: 700; color: #94a3b8; }
          .warning-badge {
            margin-top: 3px; font-size: 8px; color: #d97706;
            background: #fef3c7; border-radius: 3px; padding: 1px 3px;
          }
          .tue-badge {
            font-size: 8px; background: #dbeafe; color: #1d4ed8;
            border-radius: 3px; padding: 1px 3px; margin-left: 3px;
          }
          .legend {
            display: flex; gap: 16px; margin-bottom: 10px;
            font-size: 10px; color: #64748b;
          }
          .legend-item { display: flex; align-items: center; gap: 4px; }
          .legend-dot { width: 10px; height: 10px; border-radius: 2px; }
          @media print {
            body { padding: 8px; }
            @page { margin: 0.5cm; size: landscape; }
          }
        </style>
      </head>
      <body>
        <h1>Deccan Dental — ${formatMonthYear(year, month)}</h1>
        <p class="subtitle">Printed ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · FD = Front Desk · Hyg = Hygienist · * = Temp Staff</p>

        <div class="legend">
          <div class="legend-item"><div class="legend-dot" style="background:#bbf7d0;border:1px solid #86efac"></div> Fully staffed</div>
          <div class="legend-item"><div class="legend-dot" style="background:#fef3c7;border:1px solid #fde68a"></div> Has warning</div>
          <div class="legend-item"><div class="legend-dot" style="background:#f8fafc;border:1px solid #e2e8f0"></div> Closed / Weekend</div>
          <div class="legend-item">* = Temp staff</div>
        </div>

        <table>
          <thead>
            <tr class="header-row">
              ${DAY_HEADERS.map((h) => `<th>${h}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </body>
      </html>
    `;

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
