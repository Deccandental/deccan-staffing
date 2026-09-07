import { Employee } from "@/types/employee";
import { loadStaff, loadPrefs } from "./staffStore";
import { getOverrides } from "./overrides";
import { getOpenTuesdays } from "./openTuesdays";
import { loadHolidays } from "./holidays";
import { loadSchedule, MonthSchedule } from "./scheduleStore";
import { buildDailyAssignments } from "./assignmentEngine";
import { resolveDentistAssistants } from "./assistantSlots";
import { generateMonth } from "@/utils/calendar";

export interface UpcomingShift {
  date: string;
  role: "Dentist" | "Assistant" | "Front Desk" | "Hygienist" | "Floater";
  detail?: string;
}

function monthKey(y: number, m: number): string {
  return `${y}-${m}`;
}

// Local calendar-date string (YYYY-MM-DD), deliberately NOT going through
// toISOString() (which converts to UTC first) — everywhere else in this app
// (generateMonth, ScheduleBuilder, PublicCalendar) builds date strings from
// local date components directly, and this needs to match exactly or a
// day's lookup against generateMonth's date list can silently miss.
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Scans the real schedule (same engine used everywhere else) for the next
 * `daysAhead` days and returns every day this employee is actually on the
 * schedule, in whatever role(s) they're assigned that day.
 */
export async function loadUpcomingShiftsForEmployee(employeeId: number, daysAhead: number = 21): Promise<UpcomingShift[]> {
  const [staff, prefs, overrides, openTuesdays, holidays] = await Promise.all([
    loadStaff(), loadPrefs(), getOverrides(), getOpenTuesdays(), loadHolidays(),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + daysAhead);

  // Figure out which months' schedules we need, then load them all up front.
  const monthsNeeded = new Set<string>();
  const scan = new Date(today);
  while (scan <= endDate) {
    monthsNeeded.add(monthKey(scan.getFullYear(), scan.getMonth() + 1));
    scan.setDate(scan.getDate() + 1);
  }
  const schedules: Record<string, MonthSchedule> = {};
  await Promise.all(
    Array.from(monthsNeeded).map(async (key) => {
      const [y, m] = key.split("-").map(Number);
      schedules[key] = await loadSchedule(y, m);
    })
  );

  const shifts: UpcomingShift[] = [];
  const cursor = new Date(today);

  while (cursor <= endDate) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const dateStr = localDateStr(cursor);
    const days = generateMonth(y, m, openTuesdays, holidays);
    const dayInfo = days.find((d) => d.date === dateStr);

    if (dayInfo?.isOpen) {
      const daySched = schedules[monthKey(y, m)]?.[dateStr];
      if (daySched && daySched.dentists.length > 0) {
        const assignments = buildDailyAssignments(
          staff, daySched.dentists, dateStr, prefs, overrides,
          dayInfo.isTuesday && dayInfo.isOpenTuesday,
          daySched.frontDeskRequired ?? 2,
          daySched.hygienistsRequired ?? 1,
          daySched.assistantCounts ?? {},
          daySched.floaterAssistantId ?? null
        );
        const ao = daySched.assistantOverrides ?? {};
        const ac = daySched.assistantCounts ?? {};

        // Dentist?
        const asDentist = assignments.dentists.find((d) => d.dentist.id === employeeId);
        if (asDentist) {
          const resolved = resolveDentistAssistants(asDentist.dentist.id, asDentist.assistants, ac, ao, staff).filter(Boolean) as Employee[];
          shifts.push({ date: dateStr, role: "Dentist", detail: resolved.length > 0 ? `w/ ${resolved.map((a) => a.name).join(", ")}` : undefined });
        }

        // Assistant to any dentist?
        for (const { dentist, assistants } of assignments.dentists) {
          const resolved = resolveDentistAssistants(dentist.id, assistants, ac, ao, staff);
          if (resolved.some((a) => a?.id === employeeId)) {
            shifts.push({ date: dateStr, role: "Assistant", detail: `w/ ${dentist.name}` });
          }
        }

        // Front desk?
        if (assignments.frontDesk.some((e) => e.id === employeeId)) {
          shifts.push({ date: dateStr, role: "Front Desk" });
        }

        // Hygienist?
        const ho = daySched.hygienistOverrides ?? {};
        const hygSlotCount = daySched.hygienistsRequired ?? 1;
        const resolvedHyg = Array.from({ length: hygSlotCount }, (_, i) => {
          if (i in ho) {
            const ovId = ho[i];
            return ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
          }
          return assignments.hygienists[i] ?? null;
        });
        if (resolvedHyg.some((e) => e?.id === employeeId)) {
          shifts.push({ date: dateStr, role: "Hygienist" });
        }

        // Floater?
        if (daySched.floaterAssistantId === employeeId) {
          shifts.push({ date: dateStr, role: "Floater" });
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return shifts;
}
