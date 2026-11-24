// Pure formatting for the Open Dental blockouts. No I/O, so it can be
// tested and previewed without a connection to Open Dental.
//
// The "Staff Schedules" note copies the layout the team typed by hand:
//
//   Staff Schedules
//   KH OUT 11/23
//   PV OUT 11/23-11/27
//   Front Desk:
//   ARI/KETKI
//   AC/UNIQUE
//   CHO/MARGOT
//   HYG/ JANTSEN
//   FLOAT/ KARLA (help Jansten too)

export interface Absence {
  employeeId: number;
  name: string;              // display name, e.g. "KH"
  half: "AM" | "PM" | null;  // null = whole day
  from: string;              // yyyy-MM-dd, the whole run of leave this day belongs to
  to: string;
  reason: string;            // pto | sick | leave | other
}

export interface DayRoster {
  frontDesk: string[];
  pairs: { dentist: string; assistants: string[] }[];
  hygienists: string[];
  floater: string | null;
  floaterNote: string;
}

export const STAFF_NOTE_TITLE = "Staff Schedules";

/** "2026-11-23" -> "11/23" */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function absenceLine(a: Absence): string {
  const when = a.from === a.to ? shortDate(a.from) : `${shortDate(a.from)}-${shortDate(a.to)}`;
  return `${a.name} OUT${a.half ? ` ${a.half}` : ""} ${when}`;
}

export function buildStaffNoteLines(roster: DayRoster | null, absences: Absence[]): string[] {
  const lines = [STAFF_NOTE_TITLE];
  for (const a of [...absences].sort((x, y) => x.name.localeCompare(y.name))) lines.push(absenceLine(a));
  if (roster) {
    if (roster.frontDesk.length > 0) {
      lines.push("Front Desk:");
      lines.push(roster.frontDesk.join("/"));
    }
    for (const p of roster.pairs) {
      lines.push(`${p.dentist}/${p.assistants.length > 0 ? p.assistants.join("/") : " (no assistant)"}`);
    }
    if (roster.hygienists.length > 0) lines.push(`HYG/ ${roster.hygienists.join("/")}`);
    const note = roster.floaterNote.trim();
    if (roster.floater) lines.push(`FLOAT/ ${roster.floater}${note ? ` (${note})` : ""}`);
    else if (note) lines.push(note);
  }
  return lines;
}

/** Default name shown in Open Dental: initials for doctors ("Dr. Anita Chopra" -> "AC"), first name for everyone else. */
export function defaultDisplayName(name: string, role: string): string {
  const clean = name.replace(/^dr\.?\s+/i, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return name.toUpperCase();
  if (role === "Dentist") return words.length === 1 ? words[0].toUpperCase() : words.map((w) => w[0]).join("").toUpperCase();
  return words[0].toUpperCase();
}

const REASON_LABEL: Record<string, string> = { pto: "PTO", sick: "SICK", leave: "LEAVE", other: "OUT" };

export function providerNote(a: Absence): string {
  return `${a.name} OUT - ${REASON_LABEL[a.reason] ?? "OUT"} (staffing app)`;
}

/** Minutes since midnight <-> "HH:mm". */
export function toMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m || 0);
}
export function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export interface DayTimes { dayStart: string; midday: string; dayEnd: string; rowMinutes: number }

/** The staff note starts when the day starts and is tall enough to show every line. */
export function staffNoteSpan(lineCount: number, t: DayTimes): { start: string; stop: string } {
  const start = toMinutes(t.dayStart);
  const stop = Math.min(start + Math.max(1, lineCount) * Math.max(5, t.rowMinutes), toMinutes(t.dayEnd));
  return { start: fromMinutes(start), stop: fromMinutes(stop) };
}

/** A provider's blockout covers the half (or whole day) they are away. */
export function providerSpan(half: "AM" | "PM" | null, t: DayTimes): { start: string; stop: string } {
  if (half === "AM") return { start: t.dayStart, stop: t.midday };
  if (half === "PM") return { start: t.midday, stop: t.dayEnd };
  return { start: t.dayStart, stop: t.dayEnd };
}
