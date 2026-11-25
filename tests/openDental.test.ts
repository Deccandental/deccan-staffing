// Exercises the Open Dental sync end to end against two fakes: an in-memory
// PostgREST (for Supabase) and an in-memory Open Dental API.
//   npx --yes tsx --tsconfig tsconfig.json tests/openDental.test.ts
import http from "http";
import { AddressInfo } from "net";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, detail ?? ""); }
}

// ---------------- dates ----------------
const todayPacific = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
let monday = addDays(todayPacific, 7);
while (new Date(`${monday}T12:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, 1);
const wednesday = addDays(monday, 2);
const nextMonday = addDays(monday, 7);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

// ---------------- fake Supabase ----------------
const allWeek = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true };
const db: Record<string, any[]> = {
  staff: [
    { id: 1, name: "Dr. Anita Chopra", role: "Dentist", skills: [], default_schedule: allWeek, archived: false },
    { id: 2, name: "Unique Smith", role: "Assistant", skills: ["Assistant"], default_schedule: allWeek, archived: false },
    { id: 3, name: "Ari Patel", role: "Front Desk", skills: [], default_schedule: allWeek, archived: false },
    { id: 4, name: "Ketki Rao", role: "Front Desk", skills: [], default_schedule: allWeek, archived: false },
    { id: 5, name: "Jantsen Lee", role: "Hygienist", skills: ["Hygienist"], default_schedule: allWeek, archived: false },
    { id: 6, name: "Margot Diaz", role: "Assistant", skills: ["Assistant"], default_schedule: allWeek, archived: false },
  ],
  dentist_prefs: [{ dentist_id: 1, assistant_ids: [2] }],
  overrides: [],
  open_tuesdays: [],
  holidays: [],
  leave_requests: [],
  schedules: [
    { date: monday, dentists: ["Dr. Anita Chopra"], front_desk_required: 2, hygienists_required: 1, assistant_overrides: {}, hygienist_overrides: {}, assistant_counts: {}, floater_assistant_id: 6, floater_note: "help Jansten too" },
  ],
  temp_assignments: [],
  temps: [],
  events: [],
  od_settings: [{ id: 1, enabled: true, notes_operatory_num: 99, staff_blockout_type: 5, provider_blockout_type: 6, day_start: "07:00", midday: "12:00", day_end: "18:00", row_minutes: 10, days_ahead: 60 }],
  od_staff_links: [{ employee_id: 5, display_name: "", prov_num: 7, operatory_nums: [3] }],
  od_blockouts: [],
  od_sync_days: [],
};
let nextUuid = 1;

function matches(row: any, key: string, raw: string): boolean {
  const dot = raw.indexOf(".");
  const op = raw.slice(0, dot), val = raw.slice(dot + 1);
  const v = row[key];
  const cmp = (x: any) => (typeof v === "number" ? Number(x) : x);
  switch (op) {
    case "eq": return String(v) === val;
    case "neq": return String(v) !== val;
    case "gte": return v >= cmp(val);
    case "lte": return v <= cmp(val);
    case "is": return val === "null" ? v == null : String(v) === val;
    case "in": return val.replace(/^\(|\)$/g, "").split(",").includes(String(v));
    case "like": return new RegExp(`^${val.replace(/%/g, ".*")}$`).test(String(v));
    default: throw new Error(`fake db: op ${op}`);
  }
}
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
function filterRows(table: string, params: URLSearchParams) {
  let rows = db[table] ?? [];
  for (const [k, v] of params) if (!RESERVED.has(k)) rows = rows.filter((r) => matches(r, k, v));
  return rows;
}

const supa = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://x");
    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    if (!(table in db)) { res.statusCode = 404; res.end(JSON.stringify({ message: `no table ${table}` })); return; }
    res.setHeader("Content-Type", "application/json");
    const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    const params = url.searchParams;
    if (req.method === "GET") {
      let rows = filterRows(table, params);
      const order = params.get("order");
      if (order) { const [col, dir] = order.split("."); rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "desc" ? -1 : 1)); }
      const limit = params.get("limit"); if (limit) rows = rows.slice(0, Number(limit));
      res.end(JSON.stringify(single ? rows[0] ?? null : rows)); return;
    }
    if (req.method === "DELETE") { const gone = new Set(filterRows(table, params)); db[table] = db[table].filter((r) => !gone.has(r)); res.statusCode = 204; res.end(); return; }
    const parsed = body ? JSON.parse(body) : {};
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (req.method === "PATCH") { for (const r of filterRows(table, params)) Object.assign(r, parsed); res.statusCode = 204; res.end(); return; }
    if (req.method === "POST") {
      const conflict = params.get("on_conflict");
      const upsert = String(req.headers.prefer ?? "").includes("merge-duplicates");
      for (const r of list) {
        const existing = conflict && upsert ? db[table].find((x) => conflict.split(",").every((c) => String(x[c]) === String(r[c]))) : null;
        if (existing) Object.assign(existing, r);
        else db[table].push({ ...(table === "od_blockouts" ? { id: `u${nextUuid++}` } : {}), ...r });
      }
      res.statusCode = 201; res.end(JSON.stringify(list)); return;
    }
    res.statusCode = 405; res.end();
  });
});

// ---------------- fake Open Dental ----------------
interface Blk { ScheduleNum: number; SchedDate: string; StartTime: string; StopTime: string; BlockoutType: number; Note: string; operatories: string }
const od: { blockouts: Blk[]; calls: string[]; appts: any[] } = { blockouts: [], calls: [], appts: [] };
let nextNum = 1000;
const odServer = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "ODFHIR dev-key/cust-key") { res.statusCode = 401; res.end("bad auth"); return; }
    const url = new URL(req.url!, "http://x");
    const p = url.pathname.replace(/^\/api\/v1/, "");
    od.calls.push(`${req.method} ${p}`);
    const b = body ? JSON.parse(body) : {};
    const toBlk = (num: number): Blk => ({ ScheduleNum: num, SchedDate: b.SchedDate, StartTime: b.StartTime, StopTime: b.StopTime, BlockoutType: b.BlockoutType, Note: b.Note, operatories: b.operatoryNums });
    let m: RegExpMatchArray | null;
    if (req.method === "GET" && p === "/schedules") { res.end(JSON.stringify(od.blockouts.filter((x) => x.SchedDate === url.searchParams.get("date")))); return; }
    if (req.method === "POST" && p === "/schedules/Blockout") { const blk = toBlk(nextNum++); od.blockouts.push(blk); res.statusCode = 201; res.end(JSON.stringify(blk)); return; }
    if ((m = p.match(/^\/schedules\/(\d+)\/Blockout$/))) {
      const i = od.blockouts.findIndex((x) => x.ScheduleNum === Number(m![1]));
      if (i < 0) { res.statusCode = 400; res.end("ScheduleNum not found"); return; }
      if (req.method === "PUT") { od.blockouts[i] = toBlk(od.blockouts[i].ScheduleNum); res.end(JSON.stringify(od.blockouts[i])); return; }
      if (req.method === "DELETE") { od.blockouts.splice(i, 1); res.end(); return; }
    }
    if (req.method === "GET" && p === "/appointments") { res.end(JSON.stringify(od.appts)); return; }
    res.statusCode = 404; res.end("no route");
  });
});

async function main() {
  await new Promise<void>((r) => supa.listen(0, r));
  await new Promise<void>((r) => odServer.listen(0, r));
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(supa.address() as AddressInfo).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.OPEN_DENTAL_API_URL = `http://127.0.0.1:${(odServer.address() as AddressInfo).port}/api/v1`;
  process.env.OPEN_DENTAL_DEVELOPER_KEY = "dev-key";
  process.env.OPEN_DENTAL_CUSTOMER_KEY = "cust-key";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

  const note = await import("../src/lib/openDental/staffNote");
  const { syncRange } = await import("../src/lib/openDental/sync");

  console.log("formatting");
  const content = (over: Partial<import("../src/lib/openDental/staffNote").DayContent> = {}) => ({
    date: "2026-11-23", extraLines: [] as string[], override: null as string[] | null, closedReason: null, warnings: [], roster: null, absences: [], events: [], birthdays: [],
    upcoming: { out: [], events: [], closed: [] }, ...over,
  });
  const lines = note.buildAppBlockLines(content({
    warnings: ["1 temp assistant needed — only 3 of 4 required available."],
    roster: { frontDesk: ["ARI", "KETKI"], pairs: [{ dentist: "AC", assistants: ["UNIQUE"] }, { dentist: "SN", assistants: [] }], hygienists: ["JANTSEN"], floater: "KARLA", floaterNote: "help Jansten too" },
    absences: [{ employeeId: 9, name: "PV", half: null, from: "2026-11-23", to: "2026-11-27", reason: "pto" }, { employeeId: 8, name: "KH", half: "AM", from: "2026-11-23", to: "2026-11-23", reason: "sick" }],
    events: [{ date: "2026-11-23", time: "17:30", title: "Staff meeting", mandatory: true }],
    birthdays: ["KETKI"],
    upcoming: { out: [{ name: "CHO", from: "2026-11-25", to: "2026-11-26" }], events: [{ date: "2026-11-24", time: "12:00", title: "Lunch & learn", mandatory: false }], closed: [{ date: "2026-11-27", name: "Thanksgiving" }] },
  }));
  check("block layout", lines.join("|") === [
    "DECCAN APP - do not edit", "-- WARNINGS --", "! 1 temp assistant needed - only 3 of 4 required available.",
    "-- TEAM --", "AC/UNIQUE", "SN/ (no assistant)", "HYG/ JANTSEN", "FRONT/ ARI/KETKI", "FLOAT/ KARLA (help Jansten too)",
    "-- OFF TODAY --", "KH AM only", "PV 11/23-11/27",
    "-- EVENTS TODAY --", "5:30pm Staff meeting - required",
    "-- BIRTHDAYS --", "KETKI",
    "-- REST OF NOVEMBER --", "Off: CHO 11/25-11/26", "Event: 11/24 12pm Lunch & learn", "Closed: 11/27 Thanksgiving",
  ].join("|"), lines);
  check("admin line", note.buildAppBlockLines(content({ roster: { frontDesk: ["ARI", "KARLA"], pairs: [], hygienists: [], floater: null, floaterNote: "", admin: ["KETKI"] } })).join("|") === "DECCAN APP - do not edit|-- TEAM --|FRONT/ ARI/KARLA|ADMIN/ KETKI");
  check("holiday", note.buildAppBlockLines(content({ closedReason: "Christmas Day" })).join("|") === "DECCAN APP - do not edit|CLOSED - Christmas Day");
  check("times", note.shortTime("09:00") === "9am" && note.shortTime("12:15") === "12:15pm" && note.shortTime("00:30") === "12:30am");
  check("doctor initials", note.defaultDisplayName("Dr. Anita Chopra", "Dentist") === "AC");
  check("single-name doctor", note.defaultDisplayName("Dr. Ho", "Dentist") === "HO");
  check("assistant first name", note.defaultDisplayName("Unique Smith", "Assistant") === "UNIQUE");
  const T = { dayStart: "07:00", midday: "12:00", dayEnd: "18:00", rowMinutes: 10 };
  check("no team note -> top of the day", JSON.stringify(note.placeAppBlock(9, T, [])) === JSON.stringify({ start: "07:00", stop: "08:30" }));
  check("just under the team's note", JSON.stringify(note.placeAppBlock(3, T, [{ start: "07:00:00", stop: "08:40:00" }])) === JSON.stringify({ start: "08:40", stop: "09:10" }));
  check("below the team's note even when there's room above it", JSON.stringify(note.placeAppBlock(3, T, [{ start: "09:00", stop: "10:00" }])) === JSON.stringify({ start: "10:00", stop: "10:30" }));
  check("no room below -> room above", JSON.stringify(note.placeAppBlock(3, T, [{ start: "08:00", stop: "17:50" }])) === JSON.stringify({ start: "07:00", stop: "07:30" }));
  check("no gap big enough -> biggest gap, cut to fit", JSON.stringify(note.placeAppBlock(9, T, [{ start: "07:00", stop: "08:00" }, { start: "08:20", stop: "12:00" }, { start: "12:40", stop: "18:00" }])) === JSON.stringify({ start: "12:00", stop: "12:40" }));
  check("skips past anything else in the way", JSON.stringify(note.placeAppBlock(3, T, [{ start: "07:00", stop: "08:00" }, { start: "08:10", stop: "09:00" }])) === JSON.stringify({ start: "09:00", stop: "09:30" }));
  check("extra lines go under the title", note.buildAppBlockLines(content({ extraLines: ["Dr. Chopra late start 9am"], closedReason: "X" })).join("|") === "DECCAN APP - do not edit|Dr. Chopra late start 9am|CLOSED - X");
  check("whole text replaces everything, title kept", note.buildAppBlockLines(content({ override: ["My own text"], closedReason: "X" })).join("|") === "DECCAN APP - do not edit|My own text");
  const { normalizeBirthday } = await import("../src/lib/staffStore");
  check("birthday input", normalizeBirthday("3/14") === "03-14" && normalizeBirthday("12-01") === "12-01" && normalizeBirthday("2/30") === "invalid" && normalizeBirthday("") === null);

  console.log("first sync creates the Deccan App blockout");
  // The team's own hand-typed note at the top of the Notes column.
  od.blockouts.push({ ScheduleNum: 1, SchedDate: monday, StartTime: "07:00:00", StopTime: "08:00:00", BlockoutType: 9, Note: "Staff Schedules\nFront Desk:\nARI", operatories: "99" });
  let r = await syncRange(monday, monday);
  const appBlk = (date = monday) => od.blockouts.find((b) => b.operatories === "99" && b.SchedDate === date && b.BlockoutType === 5);
  const head = (date = monday) => (appBlk(date)?.Note ?? "").split("\n-- REST OF")[0];
  check("one change", r.results[0]?.changes === 1, r);
  check("block text", head() === "DECCAN APP - do not edit\n-- TEAM --\nAC/UNIQUE\nHYG/ JANTSEN\nFRONT/ ARI/KETKI\nFLOAT/ MARGOT (help Jansten too)", appBlk()?.Note);
  check("own blockout type, just under the team's note", appBlk()?.StartTime === "08:00:00" && appBlk()?.StopTime === "09:00:00", appBlk());
  check("team's own note untouched", od.blockouts.find((b) => b.ScheduleNum === 1)?.Note === "Staff Schedules\nFront Desk:\nARI");
  check("recorded", db.od_blockouts.length === 1 && db.od_blockouts[0].kind === "staff");

  console.log("nothing changed -> nothing sent");
  od.calls = [];
  r = await syncRange(monday, monday);
  check("no writes", r.results[0]?.changes === 0 && !od.calls.some((c) => !c.startsWith("GET")), od.calls);

  console.log("events, birthdays, warnings");
  db.events.push({ date: monday, time: "17:30", title: "Staff meeting", mandatory: true });
  db.staff.find((e) => e.id === 4)!.birthday = monday.slice(5);
  db.schedules[0].assistant_counts = { 1: 2 };
  r = await syncRange(monday, monday);
  const n1 = appBlk()?.Note ?? "";
  check("event today", n1.includes("-- EVENTS TODAY --\n5:30pm Staff meeting - required"), n1);
  check("birthday", n1.includes("-- BIRTHDAYS --\nKETKI"), n1);
  check("shortage warning, with Open Dental names, no repeats", n1.includes("-- WARNINGS --\n! Only 1 of 2 assistants available for AC - 1 temp needed.\n-- TEAM --") && !n1.includes("Anita"), n1);
  db.schedules[0].assistant_counts = {};

  console.log("approved leave for a hygienist");
  db.leave_requests.push({ id: "l1", employee_id: 5, employee_name: "Jantsen Lee", start_date: monday, end_date: wednesday, starts_midday: false, ends_midday: true, status: "approved", reason: "pto", total_days: 2.5, submitted_at: "x" });
  od.appts = [{ AptNum: 1, AptDateTime: `${monday} 09:00:00`, AptStatus: "Scheduled", ProvNum: 1, ProvHyg: 7, Op: 3 }, { AptNum: 2, AptDateTime: `${monday} 10:00:00`, AptStatus: "Scheduled", ProvNum: 1, ProvHyg: 7, Op: 3 }];
  r = await syncRange(monday, wednesday);
  const n2 = appBlk()?.Note ?? "";
  check("off today with dates", n2.includes(`-- OFF TODAY --\nJANTSEN ${md(monday)}-${md(wednesday)}`) && !n2.includes("HYG/"), n2);
  check("booked while off", n2.includes("! JANTSEN is off but has 2 patients booked"), n2);
  check("half day on the last day", (appBlk(wednesday)?.Note ?? "").includes(`JANTSEN AM only (${md(monday)}-${md(wednesday)})`), appBlk(wednesday)?.Note);
  const prov = od.blockouts.filter((b) => b.operatories === "3");
  check("provider blockout on each open day, on their column", prov.length === 2 && prov.every((b) => b.BlockoutType === 6), prov);
  check("back at midday -> only the morning is blocked", prov.find((b) => b.SchedDate === wednesday)?.StopTime === "12:00:00");
  check("closed Tuesday gets nothing", !od.blockouts.some((b) => b.SchedDate === addDays(monday, 1)));

  console.log("leave cancelled");
  db.leave_requests[0].status = "cancelled";
  od.appts = [];
  r = await syncRange(monday, wednesday);
  check("provider blockouts removed", od.blockouts.filter((b) => b.operatories === "3").length === 0, od.blockouts);
  check("block back to normal", (appBlk()?.Note ?? "").includes("HYG/ JANTSEN") && !(appBlk()?.Note ?? "").includes("OFF TODAY"), appBlk()?.Note);

  console.log("holiday");
  const thursday = addDays(monday, 3);
  db.holidays.push({ date: thursday, name: "Founders Day", type: "holiday" });
  r = await syncRange(monday, thursday);
  check("CLOSED on the day", (appBlk(thursday)?.Note ?? "").startsWith("DECCAN APP - do not edit\nCLOSED - Founders Day"), appBlk(thursday)?.Note);
  check("no team on a closed day", !(appBlk(thursday)?.Note ?? "").includes("-- TEAM --"));
  check("listed in the rest of the month", thursday.slice(0, 7) !== monday.slice(0, 7) || (appBlk()?.Note ?? "").includes(`Closed: ${md(thursday)} Founders Day`), appBlk()?.Note);

  console.log("merge rules");
  const M = note.mergeStaffNote;
  check("unchanged -> none", M(["A", "B"], ["A", "B"], ["A", "B"]).action === "none");
  check("added line kept", JSON.stringify(M(["A", "B", "late start"], ["A", "B"], ["A", "C"])) === JSON.stringify({ action: "write", lines: ["A", "C", "late start"] }));
  check("removed app line removed", JSON.stringify(M(["T", "X 1/2", "A"], ["T", "X 1/2", "A"], ["T", "A"])) === JSON.stringify({ action: "write", lines: ["T", "A"] }));
  check("changed line -> conflict", M(["A", "CHO/UNIQUE"], ["A", "CHO/MARGOT"], ["A", "CHO/MARGOT", "Z"]).action === "conflict");
  check("team already made it match -> none", M(["A", "CHO/UNIQUE"], ["A", "CHO/MARGOT"], ["A", "CHO/UNIQUE"]).action === "none");

  console.log("the team adds a line to the Deccan App blockout");
  const setNote = (text: string) => { appBlk()!.Note = text; };
  setNote(appBlk()!.Note + "\nDr. Chopra late start 9am");
  db.schedules[0].floater_note = "lab day";
  r = await syncRange(monday, monday);
  check("app's change made, their line kept", (appBlk()?.Note ?? "").includes("FLOAT/ MARGOT (lab day)") && (appBlk()?.Note ?? "").endsWith("\nDr. Chopra late start 9am"), appBlk()?.Note);
  check("status ok", r.results[0]?.status === "ok", r.results[0]);

  console.log("the team changes an assignment in it");
  setNote(appBlk()!.Note.replace("AC/UNIQUE", "AC/MARGOT"));
  const before = appBlk()!.Note;
  db.schedules[0].floater_note = "sterilization";
  r = await syncRange(monday, monday);
  check("not overwritten", appBlk()?.Note === before, appBlk()?.Note);
  check("flagged with the difference", r.results[0]?.status === "edited_in_od" && /AC\/MARGOT/.test(r.results[0]?.message ?? "") && /AC\/UNIQUE/.test(r.results[0]?.message ?? ""), r.results[0]);

  console.log("admin: use the staffing app's version");
  r = await syncRange(monday, monday, { force: true });
  check("rewritten exactly", !(appBlk()?.Note ?? "").includes("late start") && (appBlk()?.Note ?? "").includes("AC/UNIQUE") && (appBlk()?.Note ?? "").includes("(sterilization)"), appBlk()?.Note);
  check("flag cleared", r.results[0]?.status === "ok");

  console.log("the team deletes it in Open Dental");
  od.blockouts = od.blockouts.filter((b) => b !== appBlk());
  db.schedules[0].floater_note = "front desk at lunch";
  r = await syncRange(monday, monday);
  check("stays deleted", !appBlk() && r.results[0]?.status === "deleted_in_od", r.results[0]);
  db.schedules[0].floater_note = "something else";
  r = await syncRange(monday, monday);
  check("still deleted on later syncs", !appBlk() && r.results[0]?.status === "deleted_in_od");
  r = await syncRange(monday, monday, { force: true });
  check("admin can put it back", (appBlk()?.Note ?? "").includes("(something else)"), appBlk());

  console.log("a provider blockout deleted in Open Dental comes back");
  db.leave_requests[0].status = "approved";
  await syncRange(monday, monday);
  const provNum = od.blockouts.find((b) => b.operatories === "3" && b.SchedDate === monday)?.ScheduleNum;
  od.blockouts = od.blockouts.filter((b) => b.ScheduleNum !== provNum);
  r = await syncRange(monday, monday);
  check("re-created", od.blockouts.some((b) => b.operatories === "3" && b.SchedDate === monday), od.blockouts);
  db.leave_requests[0].status = "cancelled";
  await syncRange(monday, wednesday);

  console.log("changes made in the Schedule Builder");
  db.schedules[0].od_extra_lines = "Dr. Chopra late start 9am";
  r = await syncRange(monday, monday);
  check("extra line under the title", (appBlk()?.Note ?? "").startsWith("DECCAN APP - do not edit\nDr. Chopra late start 9am\n-- TEAM --"), appBlk()?.Note);
  db.schedules[0].od_override = "Short day\nAC/UNIQUE only";
  r = await syncRange(monday, monday);
  check("whole text sent as typed", appBlk()?.Note === "DECCAN APP - do not edit\nShort day\nAC/UNIQUE only", appBlk()?.Note);
  db.schedules[0].od_override = null; db.schedules[0].od_extra_lines = null;
  r = await syncRange(monday, monday);
  check("back to automatic", (appBlk()?.Note ?? "").startsWith("DECCAN APP - do not edit\n-- TEAM --"), appBlk()?.Note);

  console.log("the team's note grows -> the block moves down");
  od.blockouts.find((b) => b.ScheduleNum === 1)!.StopTime = "08:30:00";
  r = await syncRange(monday, monday);
  check("moved below it", appBlk()?.StartTime === "08:30:00", appBlk());

  console.log("Schedule Builder section (API)");
  const { createSessionToken } = await import("../src/lib/session");
  const { POST: dayRoute } = await import("../src/app/api/opendental/day/route");
  const { NextRequest } = await import("next/server");
  const tok = (canAdmin: boolean) => createSessionToken({ mode: "staff", employeeId: 1, canAdmin, canManageLeave: true, canManageEvents: false, canManageCerts: false, canManagePayroll: false });
  const callDay = async (body: any, admin = true) => {
    const res = await dayRoute(new NextRequest("http://x/api/opendental/day", { method: "POST", headers: { "x-session-token": tok(admin), "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: res.status, json: await res.json() };
  };
  let res = await callDay({ date: monday, action: "get" });
  check("get: shows the block and what Open Dental has", res.json.ok && res.json.final[0] === "DECCAN APP - do not edit" && res.json.final.join("\n") === res.json.inOd?.lines.join("\n"), res.json);
  res = await callDay({ date: monday, action: "save", extraLines: "Lab pickup 3pm", override: null }, false);
  check("save needs admin", res.status === 403);
  res = await callDay({ date: monday, action: "save", extraLines: "Lab pickup 3pm\u2014today", override: null });
  check("save: stored and sent", res.json.synced?.status === "ok" && (appBlk()?.Note ?? "").includes("\nLab pickup 3pm-today\n"), [res.json.synced, appBlk()?.Note]);
  setNote(appBlk()!.Note.replace("AC/UNIQUE", "AC/MARGOT"));
  db.schedules[0].floater_note = "x1";
  await syncRange(monday, monday);
  res = await callDay({ date: monday, action: "get" });
  check("get: reports the Open Dental edit", res.json.status?.status === "edited_in_od" && res.json.inOd.lines.includes("AC/MARGOT"), res.json.status);
  res = await callDay({ date: monday, action: "useOd" });
  check("keep Open Dental's version", res.json.synced?.status === "ok" && db.schedules[0].od_override?.includes("AC/MARGOT") && appBlk()?.Note.includes("AC/MARGOT"), [res.json.synced, db.schedules[0].od_override]);
  res = await callDay({ date: monday, action: "save", extraLines: "", override: null });
  check("back to automatic", res.json.synced?.status === "ok" && !!appBlk()?.Note.includes("AC/UNIQUE") && !appBlk()?.Note.includes("Lab pickup"), appBlk()?.Note);

  console.log("past dates are never touched");
  r = await syncRange(addDays(todayPacific, -10), addDays(todayPacific, -1));
  check("no days synced", r.results.length === 0, r);

  console.log("wrong keys");
  process.env.OPEN_DENTAL_CUSTOMER_KEY = "nope";
  db.schedules[0].floater_note = "changed";
  r = await syncRange(monday, wednesday);
  check("reported as an error on every day", r.results.length === 3 && r.results.every((x) => x.status === "error" && /401/.test(x.message ?? "")), r.results);
  check("day status saved", db.od_sync_days.find((d) => d.date === monday)?.status === "error");

  supa.close(); odServer.close();
  console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
