// Server-only: works out, for each date, everything the Deccan App blockout
// shows — the team (same assignment engine as the Schedule Builder), who is
// off, warnings, holidays, events, birthdays and the rest of the month.
// Reads with the service-role client, so it must only be imported from API routes.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rowToEmployee } from "@/lib/staffStore";
import { rowToLeave, leaveHalfOnDate, isFullDayLeave } from "@/lib/leaveStore";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { resolveDentistAssistants } from "@/lib/assistantSlots";
import { getWeekday } from "@/lib/dateUtils";
import { generateMonth } from "@/utils/calendar";
import type { Employee } from "@/types/employee";
import type { LeaveRequest } from "@/types/leave";
import type { StaffOverride } from "@/lib/overrides";
import type { DaySchedule } from "@/lib/scheduleStore";
import { Absence, DayContent, DayEvent, DayRoster, defaultDisplayName, splitLines } from "./staffNote";

export interface StaffLink { employeeId: number; displayName: string; provNum: number | null; operatoryNums: number[] }

export interface DayPlan {
  date: string;
  isOpen: boolean;
  /** What the Deccan App block shows; null on days with no block (weekends, regular closed Tuesdays). */
  content: DayContent | null;
  absences: Absence[];
  /** Everyone on the day's plan, so Open Dental bookings can be checked against it. */
  workingIds: number[];
}

interface Loaded {
  staff: Employee[];
  prefs: Record<number, number[]>;
  overrides: StaffOverride[];
  openTuesdays: { date: string; halfDay: "AM" | "PM" | null }[];
  holidays: { date: string; name: string }[];
  leave: LeaveRequest[];
  schedules: Record<string, DaySchedule & { floaterNote?: string; odExtraLines?: string; odOverride?: string | null }>;
  temps: { date: string; role: string; notes: string; name: string }[];
  events: DayEvent[];
  links: Map<number, StaffLink>;
}

async function must<T>(p: PromiseLike<{ data: T | null; error: any }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`Couldn't load ${what}: ${error.message}`);
  return (data ?? []) as T;
}

export async function loadStaffLinks(): Promise<Map<number, StaffLink>> {
  const rows = await must<any[]>(supabaseAdmin.from("od_staff_links").select("*"), "Open Dental staff links");
  return new Map(rows.map((r) => [r.employee_id, {
    employeeId: r.employee_id, displayName: r.display_name ?? "", provNum: r.prov_num ?? null, operatoryNums: r.operatory_nums ?? [],
  }]));
}

const STAFF_COLS = "id, name, role, specialty, color, skills, archived, default_schedule, remote_days, employment_type";

export async function loadStaffForOd(): Promise<Employee[]> {
  let res: { data: any[] | null; error: any } = await supabaseAdmin.from("staff").select(`${STAFF_COLS}, birthday`).order("id");
  // Until the birthday column has been added, load without it.
  if (res.error) res = await supabaseAdmin.from("staff").select(STAFF_COLS).order("id");
  if (res.error) throw new Error(`Couldn't load staff: ${res.error.message}`);
  return (res.data ?? []).map(rowToEmployee);
}

/** Last day of the month `ymd` is in. */
export function monthEnd(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

async function load(from: string, to: string): Promise<Loaded> {
  const [staff, prefRows, ovRows, otRows, holRows, leaveRows, schedRows, taRows, tempRows, eventRows, links] = await Promise.all([
    loadStaffForOd(),
    must<any[]>(supabaseAdmin.from("dentist_prefs").select("*"), "assistant preferences"),
    must<any[]>(supabaseAdmin.from("overrides").select("*").gte("date", from).lte("date", to), "availability"),
    must<any[]>(supabaseAdmin.from("open_tuesdays").select("*"), "open Tuesdays"),
    must<any[]>(supabaseAdmin.from("holidays").select("*"), "holidays"),
    must<any[]>(supabaseAdmin.from("leave_requests").select("*").eq("status", "approved").lte("start_date", to).gte("end_date", from), "leave"),
    must<any[]>(supabaseAdmin.from("schedules").select("*").gte("date", from).lte("date", to), "schedules"),
    must<any[]>(supabaseAdmin.from("temp_assignments").select("*").gte("date", from).lte("date", to), "temp assignments"),
    must<any[]>(supabaseAdmin.from("temps").select("id, name"), "temps"),
    must<any[]>(supabaseAdmin.from("events").select("date, time, title, mandatory").gte("date", from).lte("date", to), "events"),
    loadStaffLinks(),
  ]);
  const prefs: Record<number, number[]> = {};
  for (const r of prefRows) prefs[r.dentist_id] = r.assistant_ids ?? [];
  const schedules: Loaded["schedules"] = {};
  for (const r of schedRows) {
    schedules[r.date] = {
      dentists: r.dentists ?? [], frontDeskRequired: r.front_desk_required ?? 2, hygienistsRequired: r.hygienists_required ?? 1,
      assistantOverrides: r.assistant_overrides ?? {}, hygienistOverrides: r.hygienist_overrides ?? {},
      assistantCounts: r.assistant_counts ?? {}, floaterAssistantId: r.floater_assistant_id ?? null, floaterNote: r.floater_note ?? "",
      odExtraLines: r.od_extra_lines ?? "", odOverride: r.od_override ?? null,
    };
  }
  const tempName = new Map(tempRows.map((t) => [t.id, String(t.name ?? "")]));
  return {
    staff, prefs, links, schedules,
    overrides: ovRows.map((r) => ({ employeeId: r.employee_id, date: r.date, reason: r.reason, halfDay: r.half_day ?? null })),
    openTuesdays: otRows.map((r) => ({ date: r.date, halfDay: r.half_day ?? null })),
    holidays: holRows.map((r) => ({ date: r.date, name: r.name })),
    leave: leaveRows.map(rowToLeave),
    temps: taRows.map((r) => ({ date: r.date, role: r.role, notes: r.notes ?? "", name: tempName.get(r.temp_id) ?? "TEMP" })),
    events: eventRows
      .map((r) => ({ date: r.date, time: r.time ?? "", title: r.title ?? "", mandatory: !!r.mandatory }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
  };
}

export function displayNameFor(emp: Employee, links: Map<number, StaffLink>): string {
  const custom = links.get(emp.id)?.displayName?.trim();
  return custom || defaultDisplayName(emp.name, emp.role);
}

const tempLabel = (name: string) => `${(name.trim().split(/\s+/)[0] || "TEMP").toUpperCase()} (temp)`;

function worksOn(e: Employee, date: string, d: Loaded): boolean {
  const weekday = getWeekday(date);
  return !!(weekday && e.defaultSchedule?.[weekday]) ||
    d.overrides.some((o) => o.employeeId === e.id && o.date === date && o.reason === "extra");
}

function absencesFor(date: string, d: Loaded): Absence[] {
  const byId = new Map(d.staff.map((e) => [e.id, e]));
  const out = new Map<number, Absence>();
  for (const r of d.leave) {
    if (date < r.startDate || date > r.endDate) continue;
    const e = byId.get(r.employeeId);
    if (!e || e.archived || !worksOn(e, date, d)) continue;
    out.set(e.id, { employeeId: e.id, name: displayNameFor(e, d.links), half: leaveHalfOnDate(r, date), from: r.startDate, to: r.endDate, reason: r.reason });
  }
  for (const o of d.overrides) {
    if (o.date !== date || o.reason === "remote" || o.reason === "extra" || out.has(o.employeeId)) continue;
    const e = byId.get(o.employeeId);
    if (!e || e.archived) continue;
    out.set(e.id, { employeeId: e.id, name: displayNameFor(e, d.links), half: o.halfDay ?? null, from: date, to: date, reason: o.reason });
  }
  return [...out.values()];
}

function rosterFor(date: string, isOpenTuesday: boolean, d: Loaded): { roster: DayRoster | null; warnings: string[]; workingIds: number[] } {
  const weekday = getWeekday(date);
  // A day nobody has opened in the Schedule Builder yet gets the same
  // defaults the builder would give it: every dentist who normally works
  // that weekday (the engine drops anyone who's out).
  const day = d.schedules[date] ?? {
    dentists: d.staff.filter((e) => e.role === "Dentist" && !e.archived && weekday && e.defaultSchedule?.[weekday]).map((e) => e.name),
    frontDeskRequired: 2, hygienistsRequired: 1, assistantOverrides: {}, hygienistOverrides: {}, assistantCounts: {}, floaterAssistantId: null, floaterNote: "",
  };
  if (day.dentists.length === 0) return { roster: null, warnings: [], workingIds: [] };

  const a = buildDailyAssignments(
    d.staff, day.dentists, date, d.prefs, d.overrides, isOpenTuesday,
    day.frontDeskRequired ?? 2, day.hygienistsRequired ?? 1, day.assistantCounts ?? {},
    day.floaterAssistantId ?? null, d.leave, day.assistantOverrides ?? {}
  );
  const name = (e: Employee) => displayNameFor(e, d.links);
  const temps = d.temps.filter((t) => t.date === date);
  const ac = day.assistantCounts ?? {};
  const ao = day.assistantOverrides ?? {};
  const working = new Set<number>();
  const warnings: string[] = [];
  // Hand-picked people can still be on approved leave (picked before it was approved).
  const offButAssigned = (e: Employee, where: string) => {
    if (d.leave.some((r) => r.employeeId === e.id && isFullDayLeave(r, date))) warnings.push(`${name(e)} is off but assigned (${where})`);
  };

  const pairs = a.dentists.map(({ dentist, assistants }) => {
    working.add(dentist.id);
    const resolved = resolveDentistAssistants(dentist.id, assistants, ac, ao, d.staff).filter((x): x is Employee => !!x);
    resolved.forEach((x) => { working.add(x.id); offButAssigned(x, name(dentist)); });
    const names = resolved.map(name);
    // A temp booked for this dentist fills the gap.
    for (const t of temps) if (t.role === "Assistant" && t.notes === `dentist:${dentist.id}`) names.push(tempLabel(t.name));
    return { dentist: name(dentist), assistants: names };
  });

  const ho = day.hygienistOverrides ?? {};
  const hygSlots = Array.from({ length: day.hygienistsRequired ?? 1 }, (_, i) => {
    if (i in ho) { const id = ho[i]; return id != null ? d.staff.find((e) => e.id === id) ?? null : null; }
    return a.hygienists[i] ?? null;
  }).filter((x): x is Employee => !!x);
  hygSlots.forEach((x) => { working.add(x.id); offButAssigned(x, "hygiene"); });
  const hygienists = hygSlots.map(name);
  for (const t of temps) if (t.role === "Hygienist") hygienists.push(tempLabel(t.name));

  a.frontDesk.forEach((x) => working.add(x.id));
  const frontDesk = a.frontDesk.map(name);
  for (const t of temps) if (t.role === "Front Desk") frontDesk.push(tempLabel(t.name));

  const floaterEmp = day.floaterAssistantId != null ? d.staff.find((e) => e.id === day.floaterAssistantId) ?? null : null;
  if (floaterEmp) { working.add(floaterEmp.id); offButAssigned(floaterEmp, "floater"); }

  // The Schedule Builder's own warnings, with names as they appear in Open Dental.
  // A temp who has been booked covers the gap, so those warnings are dropped.
  const tempCovers = (msg: string) =>
    (/assistant/i.test(msg) && temps.some((t) => t.role === "Assistant")) ||
    (/hygienist/i.test(msg) && temps.some((t) => t.role === "Hygienist")) ||
    (/front desk/i.test(msg) && temps.some((t) => t.role === "Front Desk"));
  // The overall "N temp assistants needed" repeats the per-dentist warnings; keep the specific ones.
  const perDentist = a.warnings.some((w) => /assistants? available for|No assistant available for/i.test(w.message));
  for (const w of a.warnings) {
    if (tempCovers(w.message)) continue;
    if (perDentist && /^\d+ temp assistants? needed/i.test(w.message)) continue;
    let msg = w.message;
    for (const e of d.staff) if (msg.includes(e.name)) msg = msg.split(e.name).join(name(e));
    warnings.push(msg);
  }

  return {
    roster: { frontDesk, pairs, hygienists, floater: floaterEmp ? name(floaterEmp) : null, floaterNote: day.floaterNote ?? "" },
    warnings,
    workingIds: [...working],
  };
}

/** Everything needed to write each date's blockouts, for every date from `from` to `to`. */
export async function buildDayPlans(from: string, to: string): Promise<{ plans: DayPlan[]; staff: Employee[]; links: Map<number, StaffLink> }> {
  // "Rest of the month" reaches past `to`, so load through the end of its month.
  const d = await load(from, monthEnd(to));
  const monthCache = new Map<string, ReturnType<typeof generateMonth>>();
  const dayInfo = (date: string) => {
    const [y, m] = date.split("-").map(Number);
    const key = `${y}-${m}`;
    if (!monthCache.has(key)) monthCache.set(key, generateMonth(y, m, d.openTuesdays, d.holidays));
    return monthCache.get(key)!.find((x) => x.date === date);
  };
  const holidayOn = new Map(d.holidays.map((h) => [h.date, h.name]));
  const byId = new Map(d.staff.map((e) => [e.id, e]));

  const plans: DayPlan[] = [];
  for (const date of eachDate(from, to)) {
    const info = dayInfo(date);
    const isOpen = !!info?.isOpen;
    const holiday = holidayOn.get(date) ?? null;
    if (!isOpen && !(holiday && !info?.isWeekend)) {
      plans.push({ date, isOpen, content: null, absences: [], workingIds: [] });
      continue;
    }
    const { roster, warnings, workingIds } = isOpen ? rosterFor(date, !!(info?.isTuesday && info?.isOpenTuesday), d) : { roster: null, warnings: [], workingIds: [] };
    const absences = isOpen ? absencesFor(date, d) : [];
    const mmdd = date.slice(5);

    // Rest of the month, starting tomorrow.
    const later = eachDate(addDays(date, 1), monthEnd(date));
    const out: DayContent["upcoming"]["out"] = [];
    for (const r of d.leave) {
      if (r.endDate <= date || r.startDate > monthEnd(date)) continue;
      const e = byId.get(r.employeeId);
      if (!e || e.archived) continue;
      if (r.startDate <= date && absences.some((a) => a.employeeId === r.employeeId)) continue; // already under OFF TODAY
      out.push({ name: displayNameFor(e, d.links), from: r.startDate, to: r.endDate });
    }
    for (const o of d.overrides) {
      if (o.reason === "remote" || o.reason === "extra" || !later.includes(o.date)) continue;
      if (d.leave.some((r) => r.employeeId === o.employeeId && o.date >= r.startDate && o.date <= r.endDate)) continue;
      const e = byId.get(o.employeeId);
      if (e && !e.archived) out.push({ name: displayNameFor(e, d.links), from: o.date, to: o.date });
    }
    out.sort((a, b) => (a.from + a.name).localeCompare(b.from + b.name));
    const closed = later
      .filter((x) => holidayOn.has(x) && !dayInfo(x)?.isWeekend)
      .map((x) => ({ date: x, name: holidayOn.get(x)! }));

    plans.push({
      date, isOpen, absences, workingIds,
      content: {
        date,
        extraLines: splitLines(d.schedules[date]?.odExtraLines ?? ""),
        override: d.schedules[date]?.odOverride != null ? splitLines(d.schedules[date]!.odOverride!) : null,
        closedReason: isOpen ? null : holiday,
        warnings, roster, absences,
        events: d.events.filter((e) => e.date === date),
        birthdays: isOpen ? d.staff.filter((e) => !e.archived && e.birthday === mmdd).map((e) => displayNameFor(e, d.links)) : [],
        upcoming: { out, events: d.events.filter((e) => later.includes(e.date)), closed },
      },
    });
  }
  return { plans, staff: d.staff, links: d.links };
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cur <= end && out.length < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
