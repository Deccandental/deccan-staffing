// Server-only: works out, for each date, who is out and who is assigned
// where, using the same assignment engine as the Schedule Builder. Reads with
// the service-role client, so it must only be imported from API routes.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rowToEmployee } from "@/lib/staffStore";
import { rowToLeave, leaveHalfOnDate } from "@/lib/leaveStore";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { resolveDentistAssistants } from "@/lib/assistantSlots";
import { getWeekday } from "@/lib/dateUtils";
import { generateMonth } from "@/utils/calendar";
import type { Employee } from "@/types/employee";
import type { LeaveRequest } from "@/types/leave";
import type { StaffOverride } from "@/lib/overrides";
import type { DaySchedule } from "@/lib/scheduleStore";
import { Absence, DayRoster, defaultDisplayName } from "./staffNote";

export interface StaffLink { employeeId: number; displayName: string; provNum: number | null; operatoryNums: number[] }

export interface DayPlan {
  date: string;
  isOpen: boolean;
  roster: DayRoster | null;
  absences: Absence[];
}

interface Loaded {
  staff: Employee[];
  prefs: Record<number, number[]>;
  overrides: StaffOverride[];
  openTuesdays: { date: string; halfDay: "AM" | "PM" | null }[];
  holidays: { date: string; name: string }[];
  leave: LeaveRequest[];
  schedules: Record<string, DaySchedule & { floaterNote?: string }>;
  temps: { date: string; role: string; notes: string; name: string }[];
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

export async function loadStaffForOd(): Promise<Employee[]> {
  const rows = await must<any[]>(supabaseAdmin.from("staff").select(
    "id, name, role, specialty, color, skills, archived, default_schedule, remote_days, employment_type"
  ).order("id"), "staff");
  return rows.map(rowToEmployee);
}

async function load(from: string, to: string): Promise<Loaded> {
  const [staff, prefRows, ovRows, otRows, holRows, leaveRows, schedRows, taRows, tempRows, links] = await Promise.all([
    loadStaffForOd(),
    must<any[]>(supabaseAdmin.from("dentist_prefs").select("*"), "assistant preferences"),
    must<any[]>(supabaseAdmin.from("overrides").select("*").gte("date", from).lte("date", to), "availability"),
    must<any[]>(supabaseAdmin.from("open_tuesdays").select("*"), "open Tuesdays"),
    must<any[]>(supabaseAdmin.from("holidays").select("*"), "holidays"),
    must<any[]>(supabaseAdmin.from("leave_requests").select("*").eq("status", "approved").lte("start_date", to).gte("end_date", from), "leave"),
    must<any[]>(supabaseAdmin.from("schedules").select("*").gte("date", from).lte("date", to), "schedules"),
    must<any[]>(supabaseAdmin.from("temp_assignments").select("*").gte("date", from).lte("date", to), "temp assignments"),
    must<any[]>(supabaseAdmin.from("temps").select("id, name"), "temps"),
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
  };
}

export function displayNameFor(emp: Employee, links: Map<number, StaffLink>): string {
  const custom = links.get(emp.id)?.displayName?.trim();
  return custom || defaultDisplayName(emp.name, emp.role);
}

const tempLabel = (name: string) => `${(name.trim().split(/\s+/)[0] || "TEMP").toUpperCase()} (temp)`;

function absencesFor(date: string, d: Loaded): Absence[] {
  const weekday = getWeekday(date);
  const byId = new Map(d.staff.map((e) => [e.id, e]));
  const out = new Map<number, Absence>();
  const worksThatDay = (e: Employee) =>
    (weekday ? e.defaultSchedule?.[weekday] : false) ||
    d.overrides.some((o) => o.employeeId === e.id && o.date === date && o.reason === "extra");

  for (const r of d.leave) {
    if (date < r.startDate || date > r.endDate) continue;
    const e = byId.get(r.employeeId);
    if (!e || e.archived || !worksThatDay(e)) continue;
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

function rosterFor(date: string, isOpenTuesday: boolean, d: Loaded): DayRoster | null {
  const weekday = getWeekday(date);
  // A day nobody has opened in the Schedule Builder yet gets the same
  // defaults the builder would give it: every dentist who normally works
  // that weekday (the engine drops anyone who's out).
  const saved = d.schedules[date];
  const day = saved ?? {
    dentists: d.staff.filter((e) => e.role === "Dentist" && !e.archived && weekday && e.defaultSchedule?.[weekday]).map((e) => e.name),
    frontDeskRequired: 2, hygienistsRequired: 1, assistantOverrides: {}, hygienistOverrides: {}, assistantCounts: {}, floaterAssistantId: null, floaterNote: "",
  };
  if (day.dentists.length === 0) return null;

  const a = buildDailyAssignments(
    d.staff, day.dentists, date, d.prefs, d.overrides, isOpenTuesday,
    day.frontDeskRequired ?? 2, day.hygienistsRequired ?? 1, day.assistantCounts ?? {},
    day.floaterAssistantId ?? null, d.leave, day.assistantOverrides ?? {}
  );
  const name = (e: Employee) => displayNameFor(e, d.links);
  const temps = d.temps.filter((t) => t.date === date);
  const ac = day.assistantCounts ?? {};
  const ao = day.assistantOverrides ?? {};

  const pairs = a.dentists.map(({ dentist, assistants }) => {
    const resolved = resolveDentistAssistants(dentist.id, assistants, ac, ao, d.staff);
    const names = resolved.filter((x): x is Employee => !!x).map(name);
    // A temp booked for this dentist fills the gap.
    for (const t of temps) if (t.role === "Assistant" && t.notes === `dentist:${dentist.id}`) names.push(tempLabel(t.name));
    return { dentist: name(dentist), assistants: names };
  });

  const ho = day.hygienistOverrides ?? {};
  const hygSlots = Array.from({ length: day.hygienistsRequired ?? 1 }, (_, i) => {
    if (i in ho) { const id = ho[i]; return id != null ? d.staff.find((e) => e.id === id) ?? null : null; }
    return a.hygienists[i] ?? null;
  });
  const hygienists = hygSlots.filter((x): x is Employee => !!x).map(name);
  for (const t of temps) if (t.role === "Hygienist") hygienists.push(tempLabel(t.name));

  const frontDesk = a.frontDesk.map(name);
  for (const t of temps) if (t.role === "Front Desk") frontDesk.push(tempLabel(t.name));

  const floaterEmp = day.floaterAssistantId != null ? d.staff.find((e) => e.id === day.floaterAssistantId) ?? null : null;
  return { frontDesk, pairs, hygienists, floater: floaterEmp ? name(floaterEmp) : null, floaterNote: day.floaterNote ?? "" };
}

/** Everything needed to write each date's blockouts, for every date from `from` to `to`. */
export async function buildDayPlans(from: string, to: string): Promise<{ plans: DayPlan[]; staff: Employee[]; links: Map<number, StaffLink> }> {
  const d = await load(from, to);
  const plans: DayPlan[] = [];
  const monthCache = new Map<string, ReturnType<typeof generateMonth>>();
  for (const date of eachDate(from, to)) {
    const [y, m] = date.split("-").map(Number);
    const key = `${y}-${m}`;
    if (!monthCache.has(key)) monthCache.set(key, generateMonth(y, m, d.openTuesdays, d.holidays));
    const info = monthCache.get(key)!.find((x) => x.date === date);
    const isOpen = !!info?.isOpen;
    plans.push({
      date, isOpen,
      roster: isOpen ? rosterFor(date, !!(info?.isTuesday && info?.isOpenTuesday), d) : null,
      absences: isOpen ? absencesFor(date, d) : [],
    });
  }
  return { plans, staff: d.staff, links: d.links };
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
