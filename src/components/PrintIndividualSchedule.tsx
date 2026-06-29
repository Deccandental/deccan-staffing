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
  const [mode, setMode] = useState<"print" | "email">("print");
  const staff = loadStaff();

  function getRows(emp: Employee) {
    const days = generateMonth(year, month).filter((d) => d.isOpen);
    return days.map((day) => {
      const daySched = schedule[day.date];
      if (!daySched) return null;
      const assignments = buildDailyAssignments(staff, daySched.dentists, day.date);
      const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric",
      });
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
      } else if (emp.skills.includes("Assistant") || emp.role === "RDA") {
        const pair = assignments.dentists.find((d) => d.assistant?.id === emp.id);
        const onFD = assignments.frontDesk.find((e) => e.id === emp.id);
        if (pair) {
          working = true;
          role = emp.role;
          detail = `With: ${pair.dentist.name}`;
        } else if (onFD) {
          working = true;
          role = "Front Desk";
          detail = "Front desk coverage";
        }
      } else if (emp.role === "Front Desk") {
        const onFD = assignments.frontDesk.find((e) => e.id === emp.id);
        if (onFD) { working = true; role = "Front Desk"; detail = ""; }
      } else if (emp.role === "Hygienist") {
        working = true;
        role = "Hygienist";
        detail = "";
      }

      if (!working) return null;
      return { dateLabel, role, detail };
    }).filter(Boolean);
  }

  function printFor(emp: Employee) {
    const rows = getRows(emp);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${emp.name} — ${formatMonthYear(year, month)}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #374151; padding: 32px; max-width: 800px; margin: 0 auto; }
        .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e5e7eb; }
        .avatar { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px; font-weight: bold; flex-shrink: 0; }
        .name { font-size: 22px; font-weight: bold; } .meta { color: #6b7280; font-size: 13px; margin-top: 2px; }
        .role-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { background: #f9fafb; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
        td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
        .date-col { width: 220px; } .role-col { width: 120px; } .detail-col { color: #6b7280; }
        .summary { margin-top: 20px; padding: 12px 16px; background: #f9fafb; border-radius: 8px; font-size: 13px; color: #6b7280; }
        @media print { body { padding: 16px; } @page { margin: 1cm; } }
      </style></head><body>
      <div class="header">
        <div class="avatar" style="background: ${emp.color}">${emp.name.charAt(0)}</div>
        <div>
          <div class="name">${emp.name}</div>
          <div class="meta">Deccan Dental · ${formatMonthYear(year, month)}</div>
          <div class="role-badge" style="background:${emp.color}22; color:${emp.color}">${emp.role}</div>
        </div>
      </div>
      <table><thead><tr><th class="date-col">Date</th><th class="role-col">Role</th><th class="detail-col">Details</th></tr></thead>
      <tbody>
        ${rows.length === 0
          ? `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:24px">No scheduled days found.</td></tr>`
          : rows.map((r) => `<tr><td class="date-col">${r!.dateLabel}</td><td class="role-col">${r!.role}</td><td class="detail-col">${r!.detail || "—"}</td></tr>`).join("")}
      </tbody></table>
      <div class="summary">📅 ${rows.length} working day${rows.length !== 1 ? "s" : ""} scheduled in ${formatMonthYear(year, month)}</div>
      </body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  function emailFor(emp: Employee) {
    const rows = getRows(emp);
    const monthLabel = formatMonthYear(year, month);
    const subject = encodeURIComponent(`Your Schedule — ${monthLabel} | Deccan Dental`);

    const bodyLines = [
      `Hi ${emp.name.split(" ")[0]},`,
      ``,
      `Here is your schedule for ${monthLabel} at Deccan Dental Sleep Center:`,
      ``,
      `─────────────────────────────`,
      ...rows.map((r) => `${r!.dateLabel}\n   ${r!.role}${r!.detail ? ` — ${r!.detail}` : ""}`),
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

  const ROLE_COLORS: Record<string, string> = {
    Dentist: "bg-blue-100 text-blue-700",
    RDA: "bg-purple-100 text-purple-700",
    Assistant: "bg-pink-100 text-pink-700",
    "Front Desk": "bg-sky-100 text-sky-700",
    Hygienist: "bg-emerald-100 text-emerald-700",
  };

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
          {/* Mode toggle */}
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
              <p className="text-xs text-blue-600">Opens your email app with the schedule pre-filled. Make sure each staff member's email is set in their Staff profile.</p>
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
                          <div className="text-xs text-slate-400 truncate">{(emp as any).email || "No email on file"}</div>
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
