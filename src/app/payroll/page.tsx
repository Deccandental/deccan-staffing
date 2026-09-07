"use client";

import { useState, useEffect, useMemo } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate from "@/components/AppIdentityGate";
import AccessDenied from "@/components/AccessDenied";
import { Employee } from "@/types/employee";
import { loadStaff, setLeaveBalance } from "@/lib/staffStore";
import { LeaveRequest } from "@/types/leave";
import { loadLeaveRequests } from "@/lib/leaveStore";
import { Holiday, loadHolidays } from "@/lib/holidays";
import { TempStaff } from "@/app/temps/page";
import { getTempAssignmentsForMonth } from "@/lib/tempAssignments";
import { supabase } from "@/lib/supabase";
import { PayrollEntry, loadPayrollEntries, loadPayrollEntriesInRange, savePayrollEntry } from "@/lib/payrollStore";
import { PayPeriod, getPayPeriodForDate, stepPayPeriod } from "@/lib/payPeriods";
import { getScheduledEmployeeIdsInRange } from "@/lib/staffSchedule";
import {
  GrowthBonusQuarter, GrowthBonusPayment, loadGrowthBonusQuarter, saveGrowthBonusQuarter,
  computeQuarterCalc, isEligibleForQuarter, computeDaysWorkedInQuarter, splitBonusPool,
  getQuarterDateRange, getCurrentQuarter, loadGrowthBonusPayments, addGrowthBonusPayment,
} from "@/lib/growthBonus";
import { PvBonusQuarter, loadPvBonusQuarter, savePvBonusQuarter } from "@/lib/pvBonus";
import { HoBonusMonth, loadHoBonusMonth, loadHoBonusMonths, saveHoBonusMonth } from "@/lib/hoBonus";

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
  skipped: boolean;
}

const EMPTY_ROW: RowFields = {
  hoursWorked: 0, overtimeHours: 0, ptoHours: 0, sickHours: 0,
  paidHolidayHours: 0, paidMeetingHours: 0, bonusAmount: 0, hygienePatientCount: 0, notes: "", skipped: false,
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
  const [scheduledStaffIds, setScheduledStaffIds] = useState<Set<number>>(new Set());
  const [scheduledTempIds, setScheduledTempIds] = useState<Set<string>>(new Set());
  const [manuallyAdded, setManuallyAdded] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, RowFields>>({});
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<Record<string, string>>({});
  const [globalMsg, setGlobalMsg] = useState("");
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [mainTab, setMainTab] = useState<"payroll" | "growth" | "pv" | "ho">("payroll");
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, [period.start]);

  async function refresh() {
    setLoading(true);
    const y = Number(period.start.slice(0, 4));
    const m = Number(period.start.slice(5, 7));
    const [s, t, lr, h, entries, schedIds, tempAssignments] = await Promise.all([
      loadStaff(), loadTemps(), loadLeaveRequests(), loadHolidays(), loadPayrollEntries(period.start),
      getScheduledEmployeeIdsInRange(period.start, period.end),
      getTempAssignmentsForMonth(y, m),
    ]);
    setStaff(s);
    setTemps(t);
    setLeaveRequests(lr);
    setHolidays(h);
    setScheduledStaffIds(schedIds);
    setScheduledTempIds(new Set(tempAssignments.filter((a) => a.date >= period.start && a.date <= period.end).map((a) => a.tempId)));
    setManuallyAdded(new Set());
    const entryMap: Record<string, PayrollEntry> = {};
    for (const e of entries) entryMap[e.personKey] = e;
    setSavedEntries(entryMap);
    setLoading(false);
  }

  const employeeRows: PersonRow[] = useMemo(() => {
    return staff
      .filter((e) => !e.excludeFromPayroll)
      .filter((e) => scheduledStaffIds.has(e.id) || manuallyAdded.has(`staff:${e.id}`) || savedEntries[`staff:${e.id}`])
      .map((e) => ({ personKey: `staff:${e.id}`, personName: e.name, isTemp: false, employee: e }))
      .sort((a, b) => a.personName.localeCompare(b.personName));
  }, [staff, scheduledStaffIds, manuallyAdded, savedEntries]);

  const tempRows: PersonRow[] = useMemo(() => {
    return temps
      .filter((t) => scheduledTempIds.has(t.id) || manuallyAdded.has(`temp:${t.id}`) || savedEntries[`temp:${t.id}`])
      .map((t) => ({ personKey: `temp:${t.id}`, personName: t.name, isTemp: true }))
      .sort((a, b) => a.personName.localeCompare(b.personName));
  }, [temps, scheduledTempIds, manuallyAdded, savedEntries]);

  const addablePeople: PersonRow[] = useMemo(() => {
    const shown = new Set([...employeeRows, ...tempRows].map((p) => p.personKey));
    const staffOptions = staff
      .filter((e) => !e.excludeFromPayroll && !shown.has(`staff:${e.id}`))
      .map((e) => ({ personKey: `staff:${e.id}`, personName: e.name + (e.archived ? " (archived)" : ""), isTemp: false, employee: e }));
    const tempOptions = temps
      .filter((t) => !shown.has(`temp:${t.id}`))
      .map((t) => ({ personKey: `temp:${t.id}`, personName: t.name, isTemp: true }));
    return [...staffOptions, ...tempOptions].sort((a, b) => a.personName.localeCompare(b.personName));
  }, [staff, temps, employeeRows, tempRows]);

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

  useEffect(() => {
    if (loading) return;
    const next: Record<string, RowFields> = {};
    for (const p of [...employeeRows, ...tempRows]) {
      const saved = savedEntries[p.personKey];
      if (saved) {
        next[p.personKey] = {
          hoursWorked: saved.hoursWorked, overtimeHours: saved.overtimeHours,
          ptoHours: saved.ptoHours, sickHours: saved.sickHours,
          paidHolidayHours: saved.paidHolidayHours, paidMeetingHours: saved.paidMeetingHours,
          bonusAmount: saved.bonusAmount, hygienePatientCount: saved.hygienePatientCount,
          notes: saved.notes, skipped: saved.skipped ?? false,
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
  }, [loading, savedEntries, employeeRows.length, tempRows.length]);

  function updateRow(personKey: string, field: keyof RowFields, value: number | string | boolean) {
    setRows((r) => ({ ...r, [personKey]: { ...r[personKey], [field]: value } }));
  }

  function toggleSkip(personKey: string) {
    setRows((r) => ({ ...r, [personKey]: { ...r[personKey], skipped: !r[personKey]?.skipped } }));
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

  async function saveOne(p: PersonRow): Promise<boolean> {
    const fields = rows[p.personKey] ?? EMPTY_ROW;
    const saved = await savePayrollEntry({
      payPeriodStart: period.start, payPeriodEnd: period.end,
      personKey: p.personKey, personName: p.personName,
      ...fields,
    });
    if (saved) setSavedEntries((e) => ({ ...e, [p.personKey]: saved }));
    return !!saved;
  }

  async function handleSave(p: PersonRow) {
    setSavingKey(p.personKey);
    const ok = await saveOne(p);
    setSavingKey(null);
    setSavedMsg((m) => ({ ...m, [p.personKey]: ok ? "Saved." : "Not saved — try again." }));
  }

  async function handleSaveAll() {
    setSavingAll(true);
    setGlobalMsg("");
    const all = [...employeeRows, ...tempRows];
    const results = await Promise.all(all.map((p) => saveOne(p)));
    setSavingAll(false);
    const failed = results.filter((ok) => !ok).length;
    setGlobalMsg(failed === 0 ? `Saved ${all.length} people.` : `Saved ${all.length - failed} of ${all.length} — ${failed} failed, try again.`);
  }

  async function handleBalanceChange(employee: Employee, field: "pto" | "sick", hours: number) {
    await setLeaveBalance(employee.id, field, hours);
    await refresh();
  }

  function handleAddPerson(p: PersonRow) {
    setManuallyAdded((s) => new Set(s).add(p.personKey));
    setShowAddPicker(false);
  }

  const isHygienist = (e?: Employee) => e && (e.role === "Hygienist" || e.skills.includes("Hygienist"));

  function TableSection({ title, people }: { title: string; people: PersonRow[] }) {
    if (people.length === 0) {
      return (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</h2>
          <p className="text-sm text-slate-400">Nobody in this group for this period.</p>
        </div>
      );
    }
    return (
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</h2>
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm border-collapse min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium w-20">Hours</th>
                <th className="px-2 py-2 font-medium w-16">OT</th>
                <th className="px-2 py-2 font-medium w-16">PTO</th>
                <th className="px-2 py-2 font-medium w-16">Sick</th>
                <th className="px-2 py-2 font-medium w-16">Hol.</th>
                <th className="px-2 py-2 font-medium w-16">Mtg</th>
                <th className="px-2 py-2 font-medium w-20">Bonus $</th>
                <th className="px-2 py-2 font-medium w-16">Hyg Pts</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-2 py-2 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const fields = rows[p.personKey] ?? EMPTY_ROW;
                const skipped = fields.skipped;
                const cellClass = "w-full rounded border border-slate-200 px-1.5 py-1 text-xs focus:outline-none disabled:bg-slate-50 disabled:text-slate-300";
                return (
                  <tr key={p.personKey} className={`border-b border-slate-50 last:border-0 ${skipped ? "opacity-50" : ""}`}>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                          style={{ backgroundColor: p.employee?.color ?? "#6b7280" }}>
                          {p.personName.charAt(0)}
                        </div>
                        <span className="font-medium text-slate-700">{p.personName}</span>
                      </div>
                    </td>
                    <td className="px-1 py-1.5"><input type="number" disabled={skipped} value={fields.hoursWorked} onChange={(e) => updateRow(p.personKey, "hoursWorked", Number(e.target.value))} className={cellClass} /></td>
                    <td className="px-1 py-1.5"><input type="number" disabled={skipped} value={fields.overtimeHours} onChange={(e) => updateRow(p.personKey, "overtimeHours", Number(e.target.value))} className={cellClass} /></td>
                    <td className="px-1 py-1.5">
                      {p.employee ? <input type="number" disabled={skipped} value={fields.ptoHours} onChange={(e) => updateRow(p.personKey, "ptoHours", Number(e.target.value))} className={cellClass} /> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-1 py-1.5">
                      {p.employee ? <input type="number" disabled={skipped} value={fields.sickHours} onChange={(e) => updateRow(p.personKey, "sickHours", Number(e.target.value))} className={cellClass} /> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-1 py-1.5">
                      {p.employee ? <input type="number" disabled={skipped} value={fields.paidHolidayHours} onChange={(e) => updateRow(p.personKey, "paidHolidayHours", Number(e.target.value))} className={cellClass} /> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-1 py-1.5"><input type="number" disabled={skipped} value={fields.paidMeetingHours} onChange={(e) => updateRow(p.personKey, "paidMeetingHours", Number(e.target.value))} className={cellClass} /></td>
                    <td className="px-1 py-1.5"><input type="number" disabled={skipped} value={fields.bonusAmount} onChange={(e) => updateRow(p.personKey, "bonusAmount", Number(e.target.value))} className={cellClass} /></td>
                    <td className="px-1 py-1.5">
                      {isHygienist(p.employee) ? <input type="number" disabled={skipped} value={fields.hygienePatientCount} onChange={(e) => updateRow(p.personKey, "hygienePatientCount", Number(e.target.value))} className={cellClass} title={`$${(fields.hygienePatientCount * HYGIENE_BONUS_PER_PATIENT).toFixed(2)} bonus`} /> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-2 py-1.5"><input type="text" disabled={skipped} value={fields.notes} onChange={(e) => updateRow(p.personKey, "notes", e.target.value)} className={cellClass + " min-w-[100px]"} /></td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <button onClick={() => toggleSkip(p.personKey)} className={`text-xs font-medium px-2 py-1 rounded ${skipped ? "bg-slate-100 text-slate-500" : "text-slate-400 hover:bg-slate-100"}`}>
                        {skipped ? "Unskip" : "Skip"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderCard(p: PersonRow) {
    const fields = rows[p.personKey] ?? EMPTY_ROW;
    const expanded = expandedKey === p.personKey;
    const hygieneBonus = fields.hygienePatientCount * HYGIENE_BONUS_PER_PATIENT;
    return (
      <div key={p.personKey} className="rounded-xl bg-white shadow-sm overflow-hidden">
        <button onClick={() => setExpandedKey(expanded ? null : p.personKey)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ backgroundColor: p.employee?.color ?? "#6b7280" }}>
              {p.personName.charAt(0)}
            </div>
            <span className="text-sm font-semibold text-slate-700">{p.personName}</span>
            <span className="text-xs text-slate-400">{p.employee?.role ?? "Temp"}</span>
          </div>
          <span className="text-slate-300 text-xs">{expanded ? "▲" : "▼"}</span>
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
            {p.employee && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">PTO Balance (hrs)</label>
                  <input type="number" defaultValue={p.employee.ptoBalanceHours ?? 0}
                    onBlur={(e) => handleBalanceChange(p.employee!, "pto", Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">Sick Balance (hrs)</label>
                  <input type="number" defaultValue={p.employee.sickBalanceHours ?? 0}
                    onBlur={(e) => handleBalanceChange(p.employee!, "sick", Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">Hours Worked</label>
                <input type="number" value={fields.hoursWorked} onChange={(e) => updateRow(p.personKey, "hoursWorked", Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">OT Hours</label>
                <input type="number" value={fields.overtimeHours} onChange={(e) => updateRow(p.personKey, "overtimeHours", Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">Bonus ($)</label>
                <input type="number" value={fields.bonusAmount} onChange={(e) => updateRow(p.personKey, "bonusAmount", Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />
              </div>
            </div>

            {p.employee && (
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-slate-400">PTO / Sick / Holiday (this period)</span>
                  <button onClick={() => recomputeAuto(p)} className="text-xs text-orange-500 hover:underline">↺ recompute</button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" value={fields.ptoHours} onChange={(e) => updateRow(p.personKey, "ptoHours", Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />
                  <input type="number" value={fields.sickHours} onChange={(e) => updateRow(p.personKey, "sickHours", Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />
                  <input type="number" value={fields.paidHolidayHours} onChange={(e) => updateRow(p.personKey, "paidHolidayHours", Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-0.5">Paid Meeting/Day-off Hours</label>
              <input type="number" value={fields.paidMeetingHours} onChange={(e) => updateRow(p.personKey, "paidMeetingHours", Number(e.target.value))}
                className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />
            </div>

            {isHygienist(p.employee) && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2.5 flex items-center gap-3">
                <div>
                  <label className="block text-xs text-emerald-700 mb-0.5">Hygiene Patients</label>
                  <input type="number" value={fields.hygienePatientCount} onChange={(e) => updateRow(p.personKey, "hygienePatientCount", Number(e.target.value))}
                    className="w-20 rounded-lg border border-emerald-200 px-2 py-1 text-sm focus:outline-none" />
                </div>
                <span className="text-sm text-emerald-700">× ${HYGIENE_BONUS_PER_PATIENT} = <strong>${hygieneBonus.toFixed(2)}</strong></span>
              </div>
            )}

            <input type="text" value={fields.notes} onChange={(e) => updateRow(p.personKey, "notes", e.target.value)}
              placeholder="Notes (optional)" className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none" />

            <div className="flex items-center gap-3">
              <button onClick={() => handleSave(p)} disabled={savingKey === p.personKey}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50"
                style={{ backgroundColor: "#e8622a" }}>
                {savingKey === p.personKey ? "Saving…" : "Save"}
              </button>
              <button onClick={() => toggleSkip(p.personKey)} className="text-xs text-slate-400 hover:text-slate-600 underline">
                {fields.skipped ? "Unskip (will be paid)" : "Skip (not paid this period)"}
              </button>
              {savedMsg[p.personKey] && <span className="text-xs text-slate-400">{savedMsg[p.personKey]}</span>}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">Payroll Dashboard</h1>
        </header>

        <div className="mb-4 flex rounded-lg border border-slate-200 bg-white overflow-hidden w-fit">
          <button onClick={() => setMainTab("payroll")} className="px-4 py-2 text-sm font-semibold transition"
            style={mainTab === "payroll" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
            Payroll
          </button>
          <button onClick={() => setMainTab("growth")} className="px-4 py-2 text-sm font-semibold transition"
            style={mainTab === "growth" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
            Growth Bonus
          </button>
          <button onClick={() => setMainTab("pv")} className="px-4 py-2 text-sm font-semibold transition"
            style={mainTab === "pv" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
            PV Bonus
          </button>
          <button onClick={() => setMainTab("ho")} className="px-4 py-2 text-sm font-semibold transition"
            style={mainTab === "ho" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
            Dr. Ho
          </button>
        </div>

        {mainTab === "growth" && <GrowthBonusPanel />}
        {mainTab === "pv" && <PvBonusPanel />}
        {mainTab === "ho" && <HoBonusPanel />}

        {mainTab === "payroll" && (
        <>
        <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setPeriod((p) => stepPayPeriod(p, -1))} className="rounded-lg border px-3 py-1.5 text-slate-500 hover:bg-slate-50 transition bg-white">←</button>
            <span className="font-bold min-w-[200px] text-center">{period.label}</span>
            <button onClick={() => setPeriod((p) => stepPayPeriod(p, 1))} className="rounded-lg border px-3 py-1.5 text-slate-500 hover:bg-slate-50 transition bg-white">→</button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
              <button onClick={() => setViewMode("table")} className="px-3 py-1.5 text-sm font-semibold transition"
                style={viewMode === "table" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
                Table
              </button>
              <button onClick={() => setViewMode("cards")} className="px-3 py-1.5 text-sm font-semibold transition"
                style={viewMode === "cards" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
                Cards
              </button>
            </div>
            <div className="relative">
              <button onClick={() => setShowAddPicker((s) => !s)}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                + Add Person
              </button>
              {showAddPicker && (
                <div className="absolute right-0 mt-1 w-64 max-h-72 overflow-y-auto rounded-lg bg-white shadow-lg border border-slate-200 z-10">
                  {addablePeople.length === 0 ? (
                    <p className="text-xs text-slate-400 p-3">Everyone's already listed.</p>
                  ) : addablePeople.map((p) => (
                    <button key={p.personKey} onClick={() => handleAddPerson(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition border-b border-slate-50 last:border-0">
                      {p.personName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : (
          <div className={viewMode === "table" ? "space-y-6" : "space-y-6 max-w-3xl"}>
            {viewMode === "table" ? (
              <>
                <TableSection title="Employees" people={employeeRows} />
                <TableSection title="Temps" people={tempRows} />
                <div className="flex items-center gap-3">
                  <button onClick={handleSaveAll} disabled={savingAll}
                    className="rounded-lg px-5 py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50"
                    style={{ backgroundColor: "#e8622a" }}>
                    {savingAll ? "Saving…" : `Save All (${employeeRows.length + tempRows.length})`}
                  </button>
                  {globalMsg && <span className="text-xs text-slate-400">{globalMsg}</span>}
                </div>
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Employees</h2>
                  <div className="space-y-2">
                    {employeeRows.length === 0 ? <p className="text-sm text-slate-400">No employees scheduled this period.</p> : employeeRows.map(renderCard)}
                  </div>
                </div>
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Temps</h2>
                  <div className="space-y-2">
                    {tempRows.length === 0 ? <p className="text-sm text-slate-400">No temps assigned this period.</p> : tempRows.map(renderCard)}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        </>
        )}
      </div>
    </main>
  );
}

const QUARTER_LABELS: Record<1 | 2 | 3 | 4, string> = { 1: "Q1 (Jan–Mar)", 2: "Q2 (Apr–Jun)", 3: "Q3 (Jul–Sep)", 4: "Q4 (Oct–Dec)" };

function GrowthBonusPanel() {
  const initial = getCurrentQuarter();
  const [year, setYear] = useState(initial.year);
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(initial.quarter);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [yearQuarters, setYearQuarters] = useState<Record<number, GrowthBonusQuarter>>({});
  const [yearEntries, setYearEntries] = useState<PayrollEntry[]>([]);
  const [payments, setPayments] = useState<GrowthBonusPayment[]>([]);
  const [form, setForm] = useState({ bamThreshold: 378000, netProductionCurrent: 0, netProductionPriorYear: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [payingFor, setPayingFor] = useState<number | null>(null);
  const [paymentForm, setPaymentForm] = useState({ date: new Date().toISOString().split("T")[0], amount: "", notes: "" });

  useEffect(() => { refresh(); }, [year]);

  useEffect(() => {
    const q = yearQuarters[quarter];
    if (q) setForm({ bamThreshold: q.bamThreshold, netProductionCurrent: q.netProductionCurrent, netProductionPriorYear: q.netProductionPriorYear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarter, yearQuarters]);

  async function refresh() {
    setLoading(true);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const [s, q1, q2, q3, q4, entries, pays] = await Promise.all([
      loadStaff(),
      loadGrowthBonusQuarter(year, 1), loadGrowthBonusQuarter(year, 2), loadGrowthBonusQuarter(year, 3), loadGrowthBonusQuarter(year, 4),
      loadPayrollEntriesInRange(yearStart, yearEnd),
      loadGrowthBonusPayments(),
    ]);
    setStaff(s);
    setYearQuarters({ 1: q1, 2: q2, 3: q3, 4: q4 });
    setYearEntries(entries);
    setPayments(pays.filter((p) => p.date >= yearStart && p.date <= yearEnd));
    setLoading(false);
  }

  async function handleSaveQuarter() {
    setSaving(true);
    await saveGrowthBonusQuarter({ year, quarter, ...form });
    setSaving(false);
    setSavedMsg("Saved.");
    await refresh();
  }

  function splitForQuarter(q: 1 | 2 | 3 | 4, qData: GrowthBonusQuarter | undefined) {
    if (!qData) return { calc: null as ReturnType<typeof computeQuarterCalc> | null, split: [] as ReturnType<typeof splitBonusPool> };
    const calc = computeQuarterCalc(qData);
    const { start, end } = getQuarterDateRange(year, q);
    const eligible = staff.filter((e) => isEligibleForQuarter(e, end));
    const rows = eligible.map((e) => ({ employee: e, days: computeDaysWorkedInQuarter(e.id, start, end, yearEntries) }));
    const split = calc.eligible ? splitBonusPool(calc.bonusPool, rows) : rows.map((r) => ({ employee: r.employee, days: r.days, multiplier: r.employee.growthBonusMultiplier ?? 1, points: 0, bonus: 0 }));
    return { calc, split };
  }

  const { calc, split } = splitForQuarter(quarter, yearQuarters[quarter]);

  // YTD earned per employee: sum this year's quarters that actually qualified.
  const ytdEarned: Record<number, number> = {};
  ([1, 2, 3, 4] as const).forEach((q) => {
    const { split: qSplit } = splitForQuarter(q, yearQuarters[q]);
    qSplit.forEach((row) => { ytdEarned[row.employee.id] = (ytdEarned[row.employee.id] ?? 0) + row.bonus; });
  });
  const ytdPaid: Record<number, number> = {};
  payments.forEach((p) => { ytdPaid[p.employeeId] = (ytdPaid[p.employeeId] ?? 0) + p.amount; });

  async function handleAddPayment(employeeId: number) {
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) return;
    await addGrowthBonusPayment({ employeeId, date: paymentForm.date, amount, notes: paymentForm.notes });
    setPayingFor(null);
    setPaymentForm({ date: new Date().toISOString().split("T")[0], amount: "", notes: "" });
    await refresh();
  }

  if (loading) return <p className="text-slate-400 text-sm">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
        <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
          {([1, 2, 3, 4] as const).map((q) => (
            <button key={q} onClick={() => setQuarter(q)} className="px-3 py-1.5 text-sm font-semibold transition"
              style={quarter === q ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
              {QUARTER_LABELS[q]}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-white shadow-sm p-4 space-y-3">
        <h2 className="font-bold text-slate-700">Quarter Production</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-slate-400 mb-0.5">Net Production ({year})</label>
            <input type="number" value={form.netProductionCurrent} onChange={(e) => setForm((f) => ({ ...f, netProductionCurrent: Number(e.target.value) }))}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-0.5">Net Production ({year - 1}, same quarter)</label>
            <input type="number" value={form.netProductionPriorYear} onChange={(e) => setForm((f) => ({ ...f, netProductionPriorYear: Number(e.target.value) }))}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-0.5">BAM Threshold</label>
            <input type="number" value={form.bamThreshold} onChange={(e) => setForm((f) => ({ ...f, bamThreshold: Number(e.target.value) }))}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleSaveQuarter} disabled={saving}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
            {saving ? "Saving…" : "Save"}
          </button>
          {savedMsg && <span className="text-xs text-slate-400">{savedMsg}</span>}
        </div>

        {calc && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
            <div>Delta: <strong>${calc.delta.toLocaleString()}</strong> · Growth: <strong>{(calc.growthPct * 100).toFixed(1)}%</strong></div>
            <div className="flex gap-4 text-xs">
              <span className={calc.meetsBam ? "text-green-600" : "text-red-500"}>{calc.meetsBam ? "✓" : "✗"} Exceeds BAM</span>
              <span className={calc.meetsGrowth ? "text-green-600" : "text-red-500"}>{calc.meetsGrowth ? "✓" : "✗"} 20%+ growth</span>
            </div>
            {calc.eligible ? (
              <div className="text-emerald-700 font-semibold">🎉 Bonus pool: ${calc.bonusPool.toLocaleString()} (at {(calc.tierPct * 100).toFixed(0)}% rate)</div>
            ) : (
              <div className="text-slate-400">No bonus pool this quarter — thresholds not met.</div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Days</th>
              <th className="px-2 py-2 font-medium">Mult.</th>
              <th className="px-2 py-2 font-medium">Points</th>
              <th className="px-2 py-2 font-medium">This Qtr</th>
              <th className="px-2 py-2 font-medium">Earned YTD</th>
              <th className="px-2 py-2 font-medium">Paid YTD</th>
              <th className="px-2 py-2 font-medium">Balance</th>
              <th className="px-2 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {split.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-4 text-slate-400 text-sm">No one is eligible yet for this quarter.</td></tr>
            ) : split.map((row) => {
              const earned = ytdEarned[row.employee.id] ?? 0;
              const paid = ytdPaid[row.employee.id] ?? 0;
              const balance = earned - paid;
              return (
                <tr key={row.employee.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 font-medium text-slate-700">{row.employee.name}</td>
                  <td className="px-2 py-2">{row.days}</td>
                  <td className="px-2 py-2">{row.multiplier}</td>
                  <td className="px-2 py-2">{row.points}</td>
                  <td className="px-2 py-2 font-semibold">${row.bonus.toLocaleString()}</td>
                  <td className="px-2 py-2">${earned.toLocaleString()}</td>
                  <td className="px-2 py-2">${paid.toLocaleString()}</td>
                  <td className={`px-2 py-2 font-semibold ${balance > 0 ? "text-amber-600" : "text-slate-400"}`}>${balance.toLocaleString()}</td>
                  <td className="px-2 py-2">
                    {payingFor === row.employee.id ? (
                      <div className="flex items-center gap-1">
                        <input type="date" value={paymentForm.date} onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))}
                          className="rounded border border-slate-200 px-1 py-0.5 text-xs w-28" />
                        <input type="number" placeholder="$" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                          className="rounded border border-slate-200 px-1 py-0.5 text-xs w-16" />
                        <button onClick={() => handleAddPayment(row.employee.id)} className="text-xs text-white px-2 py-0.5 rounded" style={{ backgroundColor: "#e8622a" }}>Log</button>
                        <button onClick={() => setPayingFor(null)} className="text-xs text-slate-400">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setPayingFor(row.employee.id)} className="text-xs text-orange-500 hover:underline">+ Log payment</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl bg-white shadow-sm p-4">
        <h2 className="font-bold text-slate-700 mb-2 text-sm">Payment log ({year})</h2>
        {payments.length === 0 ? <p className="text-sm text-slate-400">No payments logged yet.</p> : (
          <div className="space-y-1 text-sm max-h-64 overflow-y-auto">
            {payments.map((p) => {
              const emp = staff.find((e) => e.id === p.employeeId);
              return (
                <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">
                  <span>{emp?.name ?? "Unknown"} — {new Date(p.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}{p.notes ? ` · ${p.notes}` : ""}</span>
                  <span className="font-semibold">${p.amount.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PvBonusPanel() {
  const initial = getCurrentQuarter();
  const [year, setYear] = useState(initial.year);
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(initial.quarter);
  const [form, setForm] = useState<PvBonusQuarter>({ year: initial.year, quarter: initial.quarter, totalIncome: 0, amountPaid: 0, notes: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => { refresh(); }, [year, quarter]);

  async function refresh() {
    setLoading(true);
    const q = await loadPvBonusQuarter(year, quarter);
    setForm(q);
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    await savePvBonusQuarter(form);
    setSaving(false);
    setSavedMsg("Saved.");
  }

  const owed30 = form.totalIncome * 0.3;
  const balance = owed30 - form.amountPaid;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
        <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
          {([1, 2, 3, 4] as const).map((q) => (
            <button key={q} onClick={() => setQuarter(q)} className="px-3 py-1.5 text-sm font-semibold transition"
              style={quarter === q ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
              {QUARTER_LABELS[q]}
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
        <div className="rounded-xl bg-white shadow-sm p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400 mb-0.5">Total Income (from Open Dental)</label>
              <input type="number" value={form.totalIncome} onChange={(e) => setForm((f) => ({ ...f, totalIncome: Number(e.target.value) }))}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-0.5">Amount Paid This Quarter</label>
              <input type="number" value={form.amountPaid} onChange={(e) => setForm((f) => ({ ...f, amountPaid: Number(e.target.value) }))}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
            <div>30% of income: <strong>${owed30.toLocaleString()}</strong></div>
            <div className={balance > 0 ? "text-amber-600 font-semibold" : balance < 0 ? "text-red-500 font-semibold" : "text-slate-500"}>
              {balance > 0 ? `Still owed: $${balance.toLocaleString()}` : balance < 0 ? `Overpaid by: $${Math.abs(balance).toLocaleString()}` : "Fully paid"}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-0.5">Notes (deductions, corrections, etc.)</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={4}
              placeholder="e.g. Adjusted for procedure billed under wrong provider..."
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none resize-none" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving}
              className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
              {saving ? "Saving…" : "Save"}
            </button>
            {savedMsg && <span className="text-xs text-slate-400">{savedMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function HoBonusPanel() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [form, setForm] = useState<HoBonusMonth>({ year: today.getFullYear(), month: today.getMonth() + 1, production: 0, paid: 0, notes: "" });
  const [yearMonths, setYearMonths] = useState<HoBonusMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => { refresh(); }, [year, month]);

  async function refresh() {
    setLoading(true);
    const [m, months] = await Promise.all([loadHoBonusMonth(year, month), loadHoBonusMonths(year)]);
    setForm(m);
    setYearMonths(months);
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    await saveHoBonusMonth(form);
    setSaving(false);
    setSavedMsg("Saved.");
    await refresh();
  }

  const owed40 = form.production * 0.4;
  const balance = owed40 - form.paid;

  const yearTotals = yearMonths.reduce((acc, m) => ({
    income: acc.income + m.production, owed: acc.owed + m.production * 0.4, paid: acc.paid + m.paid,
  }), { income: 0, owed: 0, paid: 0 });

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-slate-500">Production-based — 40% of that month's production, paid out over the following month's pay periods.</p>
      <div className="flex items-center gap-3">
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
          {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </select>
      </div>

      {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
        <>
          <div className="rounded-xl bg-white shadow-sm p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">Production for {MONTH_NAMES[month - 1]} {year}</label>
                <input type="number" value={form.production} onChange={(e) => setForm((f) => ({ ...f, production: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">Paid</label>
                <input type="number" value={form.paid} onChange={(e) => setForm((f) => ({ ...f, paid: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
              <div>40%: <strong>${owed40.toLocaleString()}</strong></div>
              <div className={balance > 0 ? "text-amber-600 font-semibold" : balance < 0 ? "text-red-500 font-semibold" : "text-slate-500"}>
                {balance > 0 ? `Owed: $${balance.toLocaleString()}` : balance < 0 ? `Overpaid by: $${Math.abs(balance).toLocaleString()}` : "Fully paid"}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-0.5">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3}
                placeholder="Any adjustments..." className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none resize-none" />
            </div>

            <div className="flex items-center gap-3">
              <button onClick={handleSave} disabled={saving}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
                {saving ? "Saving…" : "Save"}
              </button>
              {savedMsg && <span className="text-xs text-slate-400">{savedMsg}</span>}
            </div>
          </div>

          <div className="rounded-xl bg-white shadow-sm p-4">
            <h2 className="font-bold text-slate-700 mb-2 text-sm">{year} Totals</h2>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><span className="text-slate-400 text-xs block">Income</span><strong>${yearTotals.income.toLocaleString()}</strong></div>
              <div><span className="text-slate-400 text-xs block">40%</span><strong>${yearTotals.owed.toLocaleString()}</strong></div>
              <div><span className="text-slate-400 text-xs block">Paid</span><strong>${yearTotals.paid.toLocaleString()}</strong></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function PayrollPage() {
  return (
    <AppIdentityGate>
      {(identity, logout) => identity.canManagePayroll ? <PayrollPageBody /> : <AccessDenied logout={logout} />}
    </AppIdentityGate>
  );
}
