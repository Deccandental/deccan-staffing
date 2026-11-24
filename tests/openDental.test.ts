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

  const note = await import("../src/lib/openDental/staffNote");
  const { syncRange } = await import("../src/lib/openDental/sync");

  console.log("formatting");
  const lines = note.buildStaffNoteLines(
    { frontDesk: ["ARI", "KETKI"], pairs: [{ dentist: "AC", assistants: ["UNIQUE"] }, { dentist: "CHO", assistants: ["MARGOT"] }], hygienists: ["JANTSEN"], floater: "KARLA", floaterNote: "help Jansten too" },
    [{ employeeId: 9, name: "PV", half: null, from: "2026-11-23", to: "2026-11-27", reason: "pto" }, { employeeId: 8, name: "KH", half: null, from: "2026-11-23", to: "2026-11-23", reason: "sick" }]
  );
  check("matches the hand-typed layout", lines.join("|") === "Staff Schedules|KH OUT 11/23|PV OUT 11/23-11/27|Front Desk:|ARI/KETKI|AC/UNIQUE|CHO/MARGOT|HYG/ JANTSEN|FLOAT/ KARLA (help Jansten too)", lines);
  check("half day label", note.absenceLine({ employeeId: 1, name: "KH", half: "AM", from: "2026-11-23", to: "2026-11-23", reason: "pto" }) === "KH OUT AM 11/23");
  check("doctor initials", note.defaultDisplayName("Dr. Anita Chopra", "Dentist") === "AC");
  check("single-name doctor", note.defaultDisplayName("Dr. Ho", "Dentist") === "HO");
  check("assistant first name", note.defaultDisplayName("Unique Smith", "Assistant") === "UNIQUE");
  check("note height grows with lines", JSON.stringify(note.staffNoteSpan(9, { dayStart: "07:00", midday: "12:00", dayEnd: "18:00", rowMinutes: 10 })) === JSON.stringify({ start: "07:00", stop: "08:30" }));

  console.log("first sync creates the Staff Schedules note");
  let r = await syncRange(monday, monday);
  const staffBlk = () => od.blockouts.find((b) => b.operatories === "99" && b.SchedDate === monday);
  check("one change", r.results[0]?.changes === 1, r);
  check("note text", staffBlk()?.Note === "Staff Schedules\nFront Desk:\nARI/KETKI\nAC/UNIQUE\nHYG/ JANTSEN\nFLOAT/ MARGOT (help Jansten too)", staffBlk()?.Note);
  check("note blockout type and times", staffBlk()?.BlockoutType === 5 && staffBlk()?.StartTime === "07:00:00" && staffBlk()?.StopTime === "08:00:00", staffBlk());
  check("recorded", db.od_blockouts.length === 1 && db.od_blockouts[0].kind === "staff");

  console.log("nothing changed -> nothing sent");
  od.calls = [];
  r = await syncRange(monday, monday);
  check("no writes", r.results[0]?.changes === 0 && !od.calls.some((c) => !c.startsWith("GET")), od.calls);

  console.log("approved leave for a hygienist");
  db.leave_requests.push({ id: "l1", employee_id: 5, employee_name: "Jantsen Lee", start_date: monday, end_date: wednesday, starts_midday: false, ends_midday: true, status: "approved", reason: "pto", total_days: 2.5, submitted_at: "x" });
  r = await syncRange(monday, wednesday);
  check("note lists them out", staffBlk()?.Note.includes(`JANTSEN OUT ${md(monday)}-${md(wednesday)}`) && !staffBlk()?.Note.includes("HYG/"), staffBlk()?.Note);
  const prov = od.blockouts.filter((b) => b.operatories === "3");
  check("provider blockout on each open day, on their column", prov.length === 2 && prov.every((b) => b.BlockoutType === 6), prov);
  const wed = prov.find((b) => b.SchedDate === wednesday);
  check("back at midday -> only the morning is blocked", wed?.StartTime === "07:00:00" && wed?.StopTime === "12:00:00", wed);
  check("closed Tuesday gets nothing", !od.blockouts.some((b) => b.SchedDate === addDays(monday, 1)));
  check("wednesday (no saved plan) still gets a note listing them out", od.blockouts.some((b) => b.operatories === "99" && b.SchedDate === wednesday && b.Note.includes("JANTSEN OUT AM")), od.blockouts.filter((b) => b.SchedDate === wednesday));

  console.log("leave cancelled");
  db.leave_requests[0].status = "cancelled";
  r = await syncRange(monday, wednesday);
  check("provider blockouts removed", od.blockouts.filter((b) => b.operatories === "3").length === 0, od.blockouts);
  check("note back to normal", staffBlk()?.Note.includes("HYG/ JANTSEN") && !staffBlk()?.Note.includes("OUT"), staffBlk()?.Note);
  check("records match Open Dental", db.od_blockouts.length === od.blockouts.length, { db: db.od_blockouts.length, od: od.blockouts.length });

  console.log("day already has a hand-made note");
  od.blockouts.push({ ScheduleNum: 1, SchedDate: nextMonday, StartTime: "07:00:00", StopTime: "08:00:00", BlockoutType: 5, Note: "Staff Schedules\nFront Desk:\nARI", operatories: "99" });
  r = await syncRange(nextMonday, nextMonday);
  check("left alone", r.results[0]?.status === "skipped_manual" && od.blockouts.filter((b) => b.SchedDate === nextMonday).length === 1, r);
  check("hand-made one untouched", od.blockouts.find((b) => b.ScheduleNum === 1)?.Note === "Staff Schedules\nFront Desk:\nARI");

  console.log("someone deleted the app's note in Open Dental");
  od.blockouts = od.blockouts.filter((b) => !(b.operatories === "99" && b.SchedDate === monday));
  db.schedules[0].floater_note = "lab day";
  r = await syncRange(monday, monday);
  check("re-created", staffBlk()?.Note.includes("FLOAT/ MARGOT (lab day)") === true, staffBlk());

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
