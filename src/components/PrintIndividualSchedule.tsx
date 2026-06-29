"use client";

import { useState } from "react";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";

interface Props {
  year: number;
  month: number;
  schedule: Record<string, { dentists: string[] }>;
}

export default function PrintIndividualSchedule({ year, month, schedule }: Props) {
  const [open, setOpen] = useState(false);
  const staff = loadStaff();

  function printFor(emp: Employee) {
    const days = generateMonth(year, month).filter((d) => d.isOpen);

    const rows = days.map((day) => {
      const daySched = schedule[day.date];
      if (!daySched) return null;

      const assignments = buildDailyAssignments(staff, daySched.dentists, day.date);
      const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric",
      });

      // Figure out what this person is doing that day
      let role = "";
      let detail = "";
      let working = false;

      if (emp.role === "Dentist") {
        const pair = assignments.dentists.find((d) => d.dentist.id === emp.id);
        if (pair) {
          working = true;
          role = "Dentist";
          detail = pair.assistant ? `Assistant: ${pair.assistant.name}` : "No assistant assigned";
        }
      } else if (emp.skills.includes("Assistant")) {
        const pair = assignments.dentists.find((d) => d.assistant?.id === emp.id);
        const onFD = assignments.frontDesk.find((e) => e.id === emp.id);
        if (pair) {
          working = true;
          role = "Assistant";
          detail = `With: ${pair.dentist.name}`;
        } else if (onFD) {
          working = true;
          role = "Front Desk (covering)";
          detail = "Covering front desk";
        }
      } else if (emp.role === "Front Desk") {
        const onFD = assignments.frontDesk.find((e) => e.id === emp.id);
        if (onFD) {
          working = true;
          role = "Front Desk";
          detail = `With: ${assignments.frontDesk.filter((e) => e.id !== emp.id).map((e) => e.name).join(", ") || "Solo"}`;
        }
      } else if (emp.role === "Hygienist") {
        const onHyg = assignments.hygienists.find((e) => e.id === emp.id);
        if (onHyg) {
          working = true;
          role = "Hygienist";
          detail = "";
        }
      }

      if (!working) return null;

      return { dateLabel, role, detail, day };
    }).filter(Boolean);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${emp.name} — ${formatMonthYear(year, month)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }

          .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e2e8f0; }
          .avatar { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px; font-weight: bold; flex-shrink: 0; }
          .name { font-size: 22px; font-weight: bold; }
          .meta { color: #64748b; font-size: 12px; margin-top: 2px; }
          .role-badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; margin-top: 4px; }

          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th { background: #f1f5f9; padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 2px solid #e2e8f0; }
          td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
          tr:nth-child(even) td { background: #f8fafc; }

          .date-col { font-weight: 600; width: 200px; }
          .role-col { width: 180px; }
          .detail-col { color: #475569; }

          .summary { margin-top: 20px; padding: 12px 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; font-size: 11px; color: #166534; }

          @media print { body { padding: 16px; } @page { margin: 1cm; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="avatar" style="background: ${emp.color}">${emp.name.charAt(0)}</div>
          <div>
            <div class="name">${emp.name}</div>
            <div class="meta">Deccan Dental · ${formatMonthYear(year, month)}</div>
            <div class="role-badge" style="background:${emp.color}22; color:${emp.color}">${emp.role}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th class="date-col">Date</th>
              <th class="role-col">Role</th>
              <th class="detail-col">Details</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:24px">No scheduled days found for this month.</td></tr>`
              : rows.map((r) => `
                <tr>
                  <td class="date-col">${r!.dateLabel}</td>
                  <td class="role-col">${r!.role}</td>
                  <td class="detail-col">${r!.detail || "—"}</td>
                </tr>`).join("")}
          </tbody>
        </table>

        <div class="summary">
          📅 ${rows.length} working day${rows.length !== 1 ? "s" : ""} scheduled in ${formatMonthYear(year, month)}
        </div>
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

  const ROLE_COLORS: Record<string, string> = {
    Dentist: "bg-blue-100 text-blue-700",
    Assistant: "bg-pink-100 text-pink-700",
    "Front Desk": "bg-sky-100 text-sky-700",
    Hygienist: "bg-emerald-100 text-emerald-700",
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold shadow hover:bg-slate-50 transition border border-slate-200"
      >
        👤 Print Individual Schedule
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl bg-white shadow-xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Select Staff Member</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {["Dentist", "Assistant", "Front Desk", "Hygienist"].map((role) => {
              const members = staff.filter((e) => e.role === role);
              if (members.length === 0) return null;
              return (
                <div key={role}>
                  <div className="px-4 py-1.5 bg-slate-50 border-y border-slate-100">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{role}s</span>
                  </div>
                  {members.map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => { printFor(emp); setOpen(false); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition text-left"
                    >
                      <div className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: emp.color }}>
                        {emp.name.charAt(0)}
                      </div>
                      <span className="text-sm font-medium">{emp.name}</span>
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
