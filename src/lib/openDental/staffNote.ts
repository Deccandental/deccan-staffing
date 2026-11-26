// Pure formatting for the Open Dental blockouts. No I/O, so it can be
// tested and previewed without a connection to Open Dental.
//
// The app writes its own "Deccan App" blockout in the Notes column, in its
// own blockout type (so its own colour), separate from the Staff Schedules
// note the team types by hand. For example:
//
//   DECCAN APP - do not edit
//   -- WARNINGS --
//   ! 1 temp assistant needed
//   -- TEAM --
//   AC/UNIQUE
//   CHO/MARGOT
//   HYG/ JANTSEN
//   FRONT/ ARI/KARLA
//   ADMIN/ KETKI
//   FLOAT/ KARLA (help Jansten too)
//   -- OFF TODAY --
//   PV 11/23-11/27
//   KH AM only
//   -- EVENTS TODAY --
//   5:30pm Staff meeting - required
//   -- BIRTHDAYS --
//   KETKI
//   -- REST OF DECEMBER --
//   Off: CHO 12/1-12/3
//   Event: 12/9 5:30pm Staff meeting - required
//   Closed: 12/25 Christmas Day

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
  /** Working that day but doing admin, e.g. "KETKI". */
  admin?: string[];
  /** The day's charge assistant (rotates fairly; see lib/charge.ts). */
  charge?: string | null;
}

export interface DayEvent { date: string; time: string; title: string; mandatory: boolean }

export interface DayContent {
  date: string;
  /** Lines added from the Schedule Builder; shown under the title. */
  extraLines: string[];
  /** The whole text as typed in the Schedule Builder; replaces everything automatic. */
  override: string[] | null;
  closedReason: string | null;  // holiday/closure name when the office is closed for it
  warnings: string[];
  roster: DayRoster | null;
  absences: Absence[];
  events: DayEvent[];
  birthdays: string[];
  upcoming: {
    out: { name: string; from: string; to: string }[];
    events: DayEvent[];
    closed: { date: string; name: string }[];
  };
}

export const APP_BLOCK_TITLE = "DECCAN APP - do not edit";
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/** "2026-11-23" -> "11/23" */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}
const range = (from: string, to: string) => (from === to ? shortDate(from) : `${shortDate(from)}-${shortDate(to)}`);

/** "17:30" -> "5:30pm", "09:00" -> "9am"; anything else is left as typed. */
export function shortTime(t: string): string {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t ?? "").trim();
  const h = Number(m[1]), min = m[2];
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min === "00" ? "" : `:${min}`}${suffix}`;
}

/** Open Dental shows plain text: no em dashes or curly quotes, no line breaks inside a line. */
export const plain = (t: string) => String(t ?? "")
  .replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[\r\n]+/g, " ").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();

export function absenceLine(a: Absence): string {
  if (a.half) return `${a.name} ${a.half} only${a.from !== a.to ? ` (${range(a.from, a.to)})` : ""}`;
  return a.from === a.to ? a.name : `${a.name} ${range(a.from, a.to)}`;
}

const eventLine = (e: DayEvent, withDate: boolean) =>
  plain(`${withDate ? `${shortDate(e.date)} ` : ""}${e.time ? `${shortTime(e.time)} ` : ""}${e.title}${e.mandatory ? " - required" : ""}`);

export function buildAppBlockLines(c: DayContent): string[] {
  if (c.override) {
    const own = c.override.map(plain).filter(Boolean);
    // The title stays first so everyone can tell where the block came from.
    return own[0] === APP_BLOCK_TITLE ? own : [APP_BLOCK_TITLE, ...own];
  }
  return [APP_BLOCK_TITLE, ...autoLines(c, true)];
}

/** Everything the app writes on its own, without the title. */
export function autoLines(c: DayContent, withExtras = false): string[] {
  const lines: string[] = [];
  if (withExtras) for (const l of c.extraLines) if (plain(l)) lines.push(plain(l));
  if (c.closedReason) lines.push(plain(`CLOSED - ${c.closedReason}`));
  if (c.warnings.length > 0) {
    lines.push("-- WARNINGS --");
    for (const w of c.warnings) lines.push(plain(`! ${w}`));
  }
  const r = c.roster;
  if (r && (r.pairs.length || r.hygienists.length || r.frontDesk.length || r.floater || r.admin?.length)) {
    lines.push("-- TEAM --");
    if (r.charge) lines.push(`CHARGE/ ${r.charge}`);
    for (const p of r.pairs) lines.push(`${p.dentist}/${p.assistants.length > 0 ? p.assistants.join("/") : " (no assistant)"}`);
    if (r.hygienists.length > 0) lines.push(`HYG/ ${r.hygienists.join("/")}`);
    if (r.frontDesk.length > 0) lines.push(`FRONT/ ${r.frontDesk.join("/")}`);
    if (r.admin && r.admin.length > 0) lines.push(`ADMIN/ ${r.admin.join("/")}`);
    const note = plain(r.floaterNote);
    if (r.floater) lines.push(`FLOAT/ ${r.floater}${note ? ` (${note})` : ""}`);
    else if (note) lines.push(note);
  }
  if (c.absences.length > 0) {
    lines.push("-- OFF TODAY --");
    for (const a of [...c.absences].sort((x, y) => x.name.localeCompare(y.name))) lines.push(absenceLine(a));
  }
  if (c.events.length > 0) {
    lines.push("-- EVENTS TODAY --");
    for (const e of c.events) lines.push(eventLine(e, false));
  }
  if (c.birthdays.length > 0) {
    lines.push("-- BIRTHDAYS --");
    lines.push(c.birthdays.join(", "));
  }
  const u = c.upcoming;
  if (u.out.length || u.events.length || u.closed.length) {
    lines.push(`-- REST OF ${MONTHS[Number(c.date.slice(5, 7)) - 1]} --`);
    for (const o of u.out) lines.push(`Off: ${o.name} ${range(o.from, o.to)}`);
    for (const e of u.events) lines.push(`Event: ${eventLine(e, true)}`);
    for (const d of u.closed) lines.push(plain(`Closed: ${shortDate(d.date)} ${d.name}`));
  }
  return lines;
}

/**
 * Where the Deccan App block goes in the Notes column. `others` are the other
 * blockouts already there (the team's own note first of all).
 *   1. Below the team's note: the first free stretch tall enough, from the
 *      end of the earliest blockout in the column down.
 *   2. Otherwise anywhere: the first free stretch tall enough, from the top.
 *   3. Otherwise the biggest free stretch, with the block cut down to fit it
 *      (better than overlapping something, which Open Dental may refuse).
 *   4. With no free space at all, the last stretch of the day.
 */
export function placeAppBlock(lineCount: number, t: DayTimes, others: { start: string; stop: string }[]): { start: string; stop: string } {
  const row = Math.max(5, t.rowMinutes);
  const len = Math.max(1, lineCount) * row;
  const dayStart = toMinutes(t.dayStart);
  const dayEnd = toMinutes(t.dayEnd);
  const taken = others
    .map((o) => ({ s: toMinutes(String(o.start).slice(0, 5)), e: toMinutes(String(o.stop).slice(0, 5)) }))
    .filter((o) => o.e > o.s)
    .sort((x, y) => x.s - y.s);

  // Free stretches of the day between the other blockouts.
  const gaps: { s: number; e: number }[] = [];
  let cursor = dayStart;
  for (const o of taken) {
    if (o.s > cursor) gaps.push({ s: cursor, e: Math.min(o.s, dayEnd) });
    cursor = Math.max(cursor, o.e);
  }
  if (cursor < dayEnd) gaps.push({ s: cursor, e: dayEnd });
  const usable = gaps.filter((g) => g.e - g.s >= row);
  const span = (s: number, l: number) => ({ start: fromMinutes(s), stop: fromMinutes(Math.min(dayEnd, s + l)) });

  const below = taken.length > 0 ? taken[0].e : dayStart;
  for (const g of usable) {
    const s = Math.max(g.s, below);
    if (g.e - s >= len) return span(s, len);
  }
  for (const g of usable) if (g.e - g.s >= len) return span(g.s, len);
  if (usable.length > 0) {
    const biggest = usable.reduce((x, y) => (y.e - y.s > x.e - x.s ? y : x));
    return span(biggest.s, Math.floor((biggest.e - biggest.s) / row) * row);
  }
  return span(Math.max(dayStart, dayEnd - len), len);
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

/** A provider's blockout covers the half (or whole day) they are away. */
export function providerSpan(half: "AM" | "PM" | null, t: DayTimes): { start: string; stop: string } {
  if (half === "AM") return { start: t.dayStart, stop: t.midday };
  if (half === "PM") return { start: t.midday, stop: t.dayEnd };
  return { start: t.dayStart, stop: t.dayEnd };
}

// ---- keeping the team's edits -------------------------------------------------

export const splitLines = (note: string) => String(note ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** a minus b, one-for-one (a line appearing twice in a and once in b leaves one), keeping a's order. */
export function linesMinus(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const l of b) left.set(l, (left.get(l) ?? 0) + 1);
  const out: string[] = [];
  for (const l of a) {
    const n = left.get(l) ?? 0;
    if (n > 0) left.set(l, n - 1); else out.push(l);
  }
  return out;
}
const containsAll = (hay: string[], needles: string[]) => linesMinus(needles, hay).length === 0;

export type MergeResult =
  | { action: "none" }                                   // Open Dental already shows everything it should
  | { action: "write"; lines: string[] }                 // safe to update; the team's added lines are kept
  | { action: "conflict"; theirs: string[]; ours: string[] }; // someone changed or removed one of the app's lines

/**
 * Decides how to update the Deccan App blockout given what Open Dental shows now
 * (`current`), what the app wrote last time (`lastApp`) and what it wants now (`desired`).
 * Lines the team added are kept at the bottom. If they changed or removed one
 * of the app's own lines, the app doesn't overwrite it; the day gets flagged.
 */
export function mergeStaffNote(current: string[], lastApp: string[] | null, desired: string[]): MergeResult {
  const base = lastApp ?? desired;
  const sameLines = (a: string[], b: string[]) => linesMinus(a, b).length === 0 && linesMinus(b, a).length === 0;
  if (containsAll(current, base)) {
    // The app's last version is all still there (plus anything the team added).
    if (sameLines(base, desired)) return { action: "none" };
    return { action: "write", lines: [...desired, ...linesMinus(current, base)] };
  }
  // Someone edited the app's lines. If they've already made it match what the
  // app wants now (and no outdated app line is left), there's nothing to do.
  const outdated = linesMinus(base, desired);
  if (containsAll(current, desired) && linesMinus(outdated, current).length === outdated.length) return { action: "none" };
  return { action: "conflict", theirs: linesMinus(current, base), ours: linesMinus(base, current) };
}
