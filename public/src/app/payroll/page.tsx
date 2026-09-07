"use client";

import { useState, useEffect, useMemo } from "react";
import { Sidebar } from "@/components/Sidebar";
import PasscodeGate from "@/components/PasscodeGate";
import { Employee } from "@/types/employee";
import { loadStaff, setLeaveBalance } from "@/lib/staffStore";
import { LeaveRequest } from "@/types/leave";
import { loadLeaveRequests } from "@/lib/leaveStore";
import { Holiday, loadHolidays } from "@/lib/holidays";
import { TempStaff } from "@/app/temps/page";
import { supabase } from "@/lib/supabase";
import { PayrollEntry, loadPayrollEntries, savePayrollEntry } from "@/lib/payrollStore";
import { PayPeriod, getPayPeriodForDate, stepPayPeriod } from "@/lib/payPeriods";

const HYGIENE_BONUS_PER_PATIENT = 15;

interface PersonRow {
  personKey: string;
  personName: string;
  isTemp: boolean;
  employee?: Employee;
}

interface RowFields {
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  sickHours: number;
  paidHolidayHours: number;
  paidMeetingHours: number;
  bonusAmount: number;
  hygienePatientCount: number;
  notes: string;
}

const EMPTY_ROW: RowFields = {
  hoursWorked: 0, overtimeHours: 0, ptoHours: 0, sickHours: 0,
  paidHolidayHours: 0, paidMeetingHours: 0, bonusAmount: 0, hygienePatientCount: 0, notes: "",
};

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

async function loadTemps(): Promise<TempStaff[]> {
  const { data, error } = await supabase.from("temps").select("*");
  if (error) { console.error("loadTemps error:", error); return []; }
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, phone: row.phone ?? "", email: row.email ?? "",
    role: row.role, skills: row.skills ?? [], rating: row.rating ?? 0,
    notes: row.notes ?? "", addedAt: row.added_at,
  }));
}

function PayrollPageBody() {
  const [period, setPeriod] = useState<PayPeriod>(() => getPayPeriodForDate(new Date()));
  const [staff, setStaff] = useState<Employee[]>([]);
  const [temps, setTemps] = useState<TempStaff[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [savedEntries, setSavedEntries] = useState<Record<string, PayrollEntry>>({});
  const [rows, setRows] = useState<Record<string, RowFields>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, [period.start]);

  async function refresh() {
    setLoading(true);
    const [s, t, lr, h, entries] = await Promise.all([
      loadStaff(), loadTemps(), loadLeaveRequests(), loadHolidays(), loadPayrollEntries(period.start),
    ]);
    setStaff(s);
    setTemps(t);
    setLeaveRequests(lr);
    setHolidays(h);
    const entryMap: Record<string, PayrollEntry> = {};
    for (const e of entries) entryMap[e.personKey] = e;
    setSavedEntries(entryMap);
    setLoading(false);
  }

  const people: PersonRow[] = useMemo(() => {
    const activeStaff = staff.filter((e) => !e.archived && !e.excludeFromPayroll);
    const staffRows: PersonRow[] = activeStaff.map((e) => ({
      personKey: `staff:${e.id}`, personName: e.name, isTemp: false, employee: e,
    }));
    const tempRows: PersonRow[] = temps.map((t) => ({
      personKey: `temp:${t.id}`, personName: t.name, isTemp: true,
    }));
    return [...staffRows, ...tempRows].sort((a, b) => a.personName.localeCompare(b.personName));
  }, [staff, temps]);

  // Sum of approved leave hours for one employee/reason overlapping the period.
  function sumApprovedHours(employeeId: number, reason: "pto" | "sick"): number {
    return leaveRequests
      .filter((r) => r.employeeId === employeeId && r.status === "approved" && r.reason === reason)
      .filter((r) => overlaps(r.startDate, r.endDate, period.start, period.end))
      .reduce((sum, r) => sum + (r.paidHours ?? r.totalDays * 8), 0);
  }

  const holidayHoursInPeriod = useMemo(() => {
    const count = holidays.filter((h) => h.type === "holiday" && h.date >= period.start && h.date <= period.end).length;
    return count * 8;
  }, [holidays, period]);

  // Whenever the underlying data for this period is loaded, (re)compute each
  // person's row — starting from a saved entry if one exists, otherwise a
  // fresh auto-calculated default.
  useEffect(() => {
    if (loading) return;
    const next: Record<string, RowFields> = {};
    for (const p of people) {
      const saved = savedEntries[p.personKey];
      if (saved) {
        next[p.personKey] = {
          hoursWorked: saved.hoursWorked, overtimeHours: saved.overtimeHours,
          ptoHours: saved.ptoHours, sickHours: saved.sickHours,
          paidHolidayHours: saved.paidHolidayHours, paidMeetingHours: saved.paidMeetingHours,
          bonusAmount: saved.bonusAmount, hygienePatientCount: saved.hygienePatientCount, notes: saved.notes,
        };
      } else {
        next[p.personKey] = {
          ...EMPTY_ROW,
          ptoHours: p.employee ? sumApprovedHours(p.employee.id, "pto") : 0,
          sickHours: p.employee ? sumApprovedHours(p.employee.id, "sick") : 0,
          paidHolidayHours: p.employee ? holidayHoursInPeriod : 0,
        };
      }
    }
    setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, savedEntries, people.length]);

  function updateRow(personKey: string, field: keyof RowFields, value: number | string) {
    setRows((r) => ({ ...r, [personKey]: { ...r[personKey], [field]: value } }));
  }

  function recomputeAuto(p: PersonRow) {
    if (!p.employee) return;
    setRows((r) => ({
      ...r,
      [p.personKey]: {
        ...r[p.personKey],
        ptoHours: sumApprovedHours(p.employee!.id, "pto"),
        sickHours: sumApprovedHours(p.employee!.id, "sick"),
        paidHolidayHours: holidayHoursInPeriod,
      },
    }));
  }

  async function handleSave(p: PersonRow) {
    setSavingKey(p.personKey);
    const fields = rows[p.personKey] ?? EMPTY_ROW;
    const saved = await savePayrollEntry({
      payPeriodStart: period.start, payPeriodEnd: period.end,
      personKey: p.personKey, personName: p.personName,
      ...fields,
    });
    setSavingKey(null);
    setSavedMsg((m) => ({ ...m, [p.personKey]: saved ? "Saved." : "Something went wrong — not saved." }));
    if (saved) setSavedEntries((e) => ({ ...e, [p.personKey]: saved }));
  }

  async function handleBalanceChange(employee: Employee, field: "pto" | "sick", hours: number) {
    await setLeaveBalance(employee.id, field, hours);
    await refresh();
  }

  const isHygienist = (e?: Employee) => e && (e.role === "Hygienist" || e.skills.includes("Hygienist"));

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Payroll Dashboard</h1>
          <p className="mt-1 text-slate-500">Reference sheet for entering payroll in Gusto — hours, PTO/sick, holiday pay, and bonuses per pay period.</p>
        </header>

        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => setPeriod((p) => stepPayPeriod(p, -1))} className="rounded-xl border px-3 py-1.5 text-slate-500 hover:bg-slate-50 transition bg-white">←</button>
          <span className="text-lg font-bold min-w-[220px] text-center">{period.label}</span>
          <button onClick={() => setPeriod((p) => stepPayPeriod(p, 1))} className="rounded-xl border px-3 py-1.5 text-slate-500 hover:bg-slate-50 transition bg-white">→</button>
        </div>

        {loading ? (
          <p className="text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-3 max-w-4xl">
            {people.length === 0 ? (
              <div className="rounded-2xl bg-white p-8 text-center shadow"><p className="text-slate-400">No staff or temps to show.</p></div>
            ) : people.map((p) => {
              const fields = rows[p.personKey] ?? EMPTY_ROW;
              const expanded = expandedKey === p.personKey;
              const hygieneBonus = fields.hygienePatientCount * HYGIENE_BONUS_PER_PATIENT;
              return (
                <div key={p.personKey} className="rounded-2xl bg-white shadow overflow-hidden">
                  <button onClick={() => setExpandedKey(expanded ? null : p.personKey)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                        style={{ backgroundColor: p.employee?.color ?? "#6b7280" }}>
                        {p.personName.charAt(0)}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-700">{p.personName}{p.isTemp && <span className="ml-2 rounded-full bg-teal-100 text-teal-700 text-xs font-semibold px-2 py-0.5">Temp</span>}</div>
                        <div className="text-xs text-slate-400">{p.employee?.role ?? "Temp staff"}</div>
                      </div>
                    </div>
                    <span className="text-slate-300 text-sm">{expanded ? "▲" : "▼"}</span>
                  </button>

                  {expanded && (
                    <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
                      {p.employee && (
                        <div className="grid gap-3 sm:grid-cols-2 rounded-xl bg-slate-50 p-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">PTO Balance (hrs)</label>
                            <input type="number" defaultValue={p.employee.ptoBalanceHours ?? 0}
                              onBlur={(e) => handleBalanceChange(p.employee!, "pto", Number(e.target.value))}
                              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Sick Balance (hrs)</label>
                            <input type="number" defaultValue={p.employee.sickBalanceHours ?? 0}
                              onBlur={(e) => handleBalanceChange(p.employee!, "sick", Number(e.target.value))}
                              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                          </div>
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 mb-1">Hours Worked</label>
                          <input type="number" value={fields.hoursWorked} onChange={(e) => updateRow(p.personKey, "hoursWorked", Number(e.target.value))}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 mb-1">Overtime Hours</label>
                          <input type="number" value={fields.overtimeHours} onChange={(e) => updateRow(p.personKey, "overtimeHours", Number(e.target.value))}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 mb-1">Bonus ($)</label>
                          <input type="number" value={fields.bonusAmount} onChange={(e) => updateRow(p.personKey, "bonusAmount", Number(e.target.value))}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                        </div>
                      </div>

                      {p.employee && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-slate-500">Auto-calculated from approved requests / holidays</span>
                            <button onClick={() => recomputeAuto(p)} className="text-xs text-orange-500 hover:underline">↺ Recompute</button>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">PTO Hours (this period)</label>
                              <input type="number" value={fields.ptoHours} onChange={(e) => updateRow(p.personKey, "ptoHours", Number(e.target.value))}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Sick Hours (this period)</label>
                              <input type="number" value={fields.sickHours} onChange={(e) => updateRow(p.personKey, "sickHours", Number(e.target.value))}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Paid Holiday Hours</label>
                              <input type="number" value={fields.paidHolidayHours} onChange={(e) => updateRow(p.personKey, "paidHolidayHours", Number(e.target.value))}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Paid Day Off for Meetings (hrs)</label>
                        <input type="number" value={fields.paidMeetingHours} onChange={(e) => updateRow(p.personKey, "paidMeetingHours", Number(e.target.value))}
                          className="w-full sm:w-48 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                      </div>

                      {isHygienist(p.employee) && (
                        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                          <label className="block text-xs font-semibold text-emerald-700 mb-1">Hygiene Patients Seen This Period</label>
                          <div className="flex items-center gap-3">
                            <input type="number" value={fields.hygienePatientCount} onChange={(e) => updateRow(p.personKey, "hygienePatientCount", Number(e.target.value))}
                              className="w-32 rounded-lg border border-emerald-200 px-2 py-1.5 text-sm focus:outline-none" />
                            <span className="text-sm text-emerald-700">× ${HYGIENE_BONUS_PER_PATIENT} = <strong>${hygieneBonus.toFixed(2)} bonus</strong></span>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
                        <textarea value={fields.notes} onChange={(e) => updateRow(p.personKey, "notes", e.target.value)} rows={2}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none resize-none" />
                      </div>

                      <div className="flex items-center gap-3">
                        <button onClick={() => handleSave(p)} disabled={savingKey === p.personKey}
                          className="rounded-xl px-5 py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50"
                          style={{ backgroundColor: "#e8622a" }}>
                          {savingKey === p.personKey ? "Saving…" : "Save"}
                        </button>
                        {savedMsg[p.personKey] && <span className="text-xs text-slate-400">{savedMsg[p.personKey]}</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

export default function PayrollPage() {
  return (
    <PasscodeGate group="payroll" subtitle="Enter your passcode to access the Payroll Dashboard">
      <PayrollPageBody />
    </PasscodeGate>
  );
}
