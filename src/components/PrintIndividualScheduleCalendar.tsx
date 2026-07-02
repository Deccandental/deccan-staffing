"use client";

import { useState, useEffect } from "react";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { loadStaff, loadPrefs, DentistPrefs } from "@/lib/staffStore";
import { getOpenTuesdays } from "@/lib/openTuesdays";
import { loadHolidays } from "@/lib/holidays";
import { getTempAssignmentsForMonth, TempAssignment } from "@/lib/tempAssignments";
import { getOverrides, StaffOverride } from "@/lib/overrides";
import { resolveDentistAssistants } from "@/lib/assistantSlots";
import { supabase } from "@/lib/supabase";
import { Employee } from "@/types/employee";
import { MonthSchedule } from "@/lib/scheduleStore";

interface Props {
  year: number;
  month: number;
  schedule: MonthSchedule;
}

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PrintIndividualScheduleCalendar({ year, month, schedule }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"print" | "email">("print");
  const [staff, setStaff] = useState<Employee[]>([]);
  const [overrides, setOverrides] = useState<StaffOverride[]>([]);
  const [prefs, setPrefs] = useState<DentistPrefs>({});

  useEffect(() => {
    loadStaff().then(setStaff);
    getOverrides().then(setOverrides);
    loadPrefs().then(setPrefs);
  }, []);

  function getWorkingInfo(emp: Employee, day: ReturnType<typeof generateMonth>[0], tempsForDay: TempAssignment[], temps: { id: string; name: string }[]) {
    const daySched = schedule[day.date];
    if (!daySched) return null;

    const assignments = buildDailyAssignments(
      staff, daySched.dentists, day.date, prefs, overrides,
      day.isTuesday && day.isOpenTuesday,
      daySched.frontDeskRequired ?? 2,
      daySched.hygienistsRequired ?? 1,
      daySched.assistantCounts ?? {},
      daySched.floaterAssistantId ?? null
    );

    const tempName = (tempId: string) => temps.find((t) => t.id === tempId)?.name ?? "Temp";
    const ao = daySched.assistantOverrides ?? {};
    const ac = daySched.assistantCounts ?? {};

    if (emp.role === "Dentist") {
      const pair = assignments.dentists.find((d) => d.dentist.id === emp.id);
      if (!pair) return null;
      const resolved = resolveDentistAssistants(pair.dentist.id, pair.assistants, ac, ao, staff).filter(Boolean) as Employee[];
      let assistantName = resolved.length > 0 ? resolved.map((a) => a.name).join(", ") : null;
      const tempForDentist = tempsForDay.find((ta) => ta.role === "Assistant" && ta.notes === `dentist:${pair.dentist.id}`);
      if (tempForDentist) assistantName = `${tempName(tempForDentist.tempId)} (temp)`;
      return { label: "Dentist", detail: assistantName ? `w/ ${assistantName}` : "No assistant" };
    }

    if (emp.skills.includes("Assistant") || emp.role === "RDA") {
      const directPair = assignments.dentists.find((d) => {
        const resolved = resolveDentistAssistants(d.dentist.id, d.assistants, ac, ao, staff);
        return resolved.some((a) => a?.id === emp.id);
      });
      if (directPair) return { label: "Assistant", detail: `w/ ${directPair.dentist.name}` };

      if (daySched.floaterAssistantId === emp.id) return { label: "Floater", detail: "Extra coverage for the day" };

      const onFD = assignments.frontDesk.find((e) => e.id === emp.id);
      if (onFD) return { label: "Front Desk", detail: "" };
    }

    if (emp.role === "Front Desk") {
      const onFD = assignments.frontDesk.find((e) => e.id === emp.id);
      if (onFD) return { label: "Front Desk", detail: "" };
    }

    if (emp.role === "Hygienist" || emp.skills.includes("Hygienist")) {
      const ho = daySched.hygienistOverrides ?? {};
      const hygSlotCount = daySched.hygienistsRequired ?? 1;
      const resolvedHygienists = Array.from({ length: hygSlotCount }, (_, i) => {
        if (i in ho) {
          const ovId = ho[i];
          return ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
        }
        return assignments.hygienists[i] ?? null;
      });
      const onHyg = resolvedHygienists.find((e) => e?.id === emp.id);
      if (onHyg) return { label: "Hygienist", detail: "" };
    }

    return null;
  }

  async function printFor(emp: Employee) {
    const [openTuesdays, holidays, tempAssignmentsList] = await Promise.all([
      getOpenTuesdays(),
      loadHolidays(),
      getTempAssignmentsForMonth(year, month),
    ]);
    const { data: tempsData } = await supabase.from("temps").select("*");
    const temps = (tempsData ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));

    const tempsByDate: Record<string, TempAssignment[]> = {};
    for (const ta of tempAssignmentsList) {
      if (!tempsByDate[ta.date]) tempsByDate[ta.date] = [];
      tempsByDate[ta.date].push(ta);
    }

    const days = generateMonth(year, month, openTuesdays, holidays);
    const firstDow = new Date(year, month - 1, 1).getDay();
    const blanks = Array.from({ length: firstDow }).map(() => null);
    const allCells = [...blanks, ...days];
    while (allCells.length % 7 !== 0) allCells.push(null);

    let workingDaysCount = 0;

    function buildCell(day: typeof days[0] | null): string {
      if (!day) return `<td class="empty-cell"></td>`;

      if (!day.isOpen) {
        return `
          <td class="day-cell closed">
            <div class="day-number">${day.day}</div>
            <div class="closed-label">${day.isHoliday ? day.holidayName : day.weekday === "Tue" ? "Closed" : "Weekend"}</div>
          </td>`;
      }

      const info = getWorkingInfo(emp, day, tempsByDate[day.date] ?? [], temps);

      if (!info) {
        return `
          <td class="day-cell open off">
            <div class="day-number">${day.day}</div>
            <div class="off-label">Off</div>
          </td>`;
      }

      workingDaysCount++;
      return `
        <td class="day-cell open working">
          <div class="day-number working-num">${day.day}${day.isTuesday ? ' <span class="tue-badge">Tue</span>' : ""}</div>
          <div class="role-badge" style="background:${emp.color}22;color:${emp.color}">${info.label}</div>
          ${info.detail ? `<div class="detail">${info.detail}</div>` : ""}
        </td>`;
    }

    const weeks: (typeof days[0] | null)[][] = [];
    for (let i = 0; i < allCells.length; i += 7) {
      weeks.push(allCells.slice(i, i + 7));
    }
    const tableRows = weeks.map((week) => `<tr>${week.map(buildCell).join("")}</tr>`).join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${emp.name} — ${formatMonthYear(year, month)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; font-size: 11px; color: #1e293b; padding: 16px; }
          .header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
          .avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 16px; font-weight: bold; flex-shrink: 0; background: ${emp.color}; }
          h1 { font-size: 18px; font-weight: bold; }
          .subtitle { color: #64748b; font-size: 11px; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 12px; }
          .header-row th {
            background: #f1f5f9; padding: 6px 4px; text-align: center;
            font-size: 10px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.05em; color: #64748b; border: 1px solid #e2e8f0;
          }
          .day-cell { border: 1px solid #e2e8f0; vertical-align: top; padding: 6px; height: 80px; }
          .empty-cell { border: 1px solid #f8fafc; background: #fafafa; }
          .closed { background: #f8fafc; }
          .off { background: #fafafa; }
          .working { background: ${emp.color}11; }
          .day-number { font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 4px; }
          .working-num { color: ${emp.color}; }
          .closed-label { font-size: 9px; color: #94a3b8; font-style: italic; }
          .off-label { font-size: 9px; color: #cbd5e1; font-style: italic; }
          .role-badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; }
          .detail { font-size: 9px; color: #475569; margin-top: 3px; }
          .tue-badge { font-size: 8px; background: #dbeafe; color: #1d4ed8; border-radius: 3px; padding: 1px 3px; margin-left: 3px; }
          .summary { margin-top: 10px; font-size: 11px; color: #64748b; }
          @media print {
            body { padding: 8px; }
            @page { margin: 0.5cm; size: landscape; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="avatar">${emp.name.charAt(0)}</div>
          <div>
            <h1>${emp.name}</h1>
            <p class="subtitle">Deccan Dental · ${formatMonthYear(year, month)} · ${emp.role}</p>
          </div>
        </div>
        <table>
          <thead>
            <tr class="header-row">${DAY_HEADERS.map((h) => `<th>${h}</th>`).join("")}</tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p class="summary">📅 ${workingDaysCount} working day${workingDaysCount !== 1 ? "s" : ""} scheduled in ${formatMonthYear(year, month)}</p>
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

  async function emailFor(emp: Employee) {
    const [openTuesdays, holidays, tempAssignmentsList] = await Promise.all([
      getOpenTuesdays(),
      loadHolidays(),
      getTempAssignmentsForMonth(year, month),
    ]);
    const { data: tempsData } = await supabase.from("temps").select("*");
    const temps = (tempsData ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));

    const tempsByDate: Record<string, TempAssignment[]> = {};
    for (const ta of tempAssignmentsList) {
      if (!tempsByDate[ta.date]) tempsByDate[ta.date] = [];
      tempsByDate[ta.date].push(ta);
    }

    const days = generateMonth(year, month, openTuesdays, holidays).filter((d) => d.isOpen);
    const rows = days.map((day) => {
      const info = getWorkingInfo(emp, day, tempsByDate[day.date] ?? [], temps);
      if (!info) return null;
      const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      return { dateLabel, role: info.label, detail: info.detail };
    }).filter(Boolean) as { dateLabel: string; role: string; detail: string }[];

    const monthLabel = formatMonthYear(year, month);
    const subject = encodeURIComponent(`Your Schedule — ${monthLabel} | Deccan Dental`);
    const bodyLines = [
      `Hi ${emp.name.split(" ")[0]},`,
      ``,
      `Here is your schedule for ${monthLabel} at Deccan Dental Sleep Center:`,
      ``,
      `─────────────────────────────`,
      ...rows.map((r) => `${r.dateLabel}\n   ${r.role}${r.detail ? ` — ${r.detail}` : ""}`),
      `─────────────────────────────`,
      ``,
      `Total: ${rows.length} working day${rows.length !== 1 ? "s" : ""}`,
      ``,
      `Please let us know if you have any questions.`,
      ``,
      `Deccan Dental Sleep Center`,
    ];
    const body = encodeURIComponent(bodyLines.join("\n"));
    const to = encodeURIComponent(emp.email ?? "");
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }

  const roleGroups = [
    { label: "Dentists", roles: ["Dentist"] },
    { label: "Assistants & RDAs", roles: ["Assistant", "RDA"] },
    { label: "Front Desk", roles: ["Front Desk"] },
    { label: "Hygienists", roles: ["Hygienist"] },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold shadow hover:bg-slate-50 transition border border-slate-200"
      >
        👤 Individual Schedule
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-72 rounded-2xl bg-white shadow-xl border border-slate-100 overflow-hidden">
          <div className="flex border-b">
            <button onClick={() => setMode("print")}
              className={`flex-1 py-2.5 text-sm font-semibold transition ${mode === "print" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              🖨️ Print
            </button>
            <button onClick={() => setMode("email")}
              className={`flex-1 py-2.5 text-sm font-semibold transition ${mode === "email" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              ✉️ Email
            </button>
          </div>

          {mode === "email" && (
            <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
              <p className="text-xs text-blue-600">Opens your email app with the schedule pre-filled.</p>
            </div>
          )}

          <div className="px-4 py-2 border-b bg-slate-50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Select Staff Member</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {roleGroups.map(({ label, roles }) => {
              const members = staff.filter((e) => roles.includes(e.role));
              if (members.length === 0) return null;
              return (
                <div key={label}>
                  <div className="px-4 py-1.5 bg-slate-50 border-y border-slate-100">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
                  </div>
                  {members.map((emp) => (
                    <button key={emp.id}
                      onClick={() => { mode === "print" ? printFor(emp) : emailFor(emp); setOpen(false); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition text-left">
                      <div className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: emp.color }}>
                        {emp.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{emp.name}</div>
                        {mode === "email" && (
                          <div className="text-xs text-slate-400 truncate">{emp.email || "No email on file"}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
