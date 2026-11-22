// Exercises /api/secure-data and the auth routes against a fake PostgREST server.
import http from "http";

const calls: { method: string; url: string; body: string; headers: any }[] = [];
const canned: Record<string, any[]> = {
  staff: [{ id: 1, name: "A", role: "Dentist", email: "a@x", pin: "123456", pto_balance_hours: 10, archived: false }],
  leave_requests: [{ id: "l1", employee_id: 1, employee_name: "A", start_date: "2026-01-01", end_date: "2026-01-02", status: "approved", notes: "secret", reason: "sick" },
                   { id: "l2", employee_id: 2, employee_name: "B", start_date: "2026-01-01", end_date: "2026-01-02", status: "approved", notes: "mine", reason: "pto" }],
  temps: [{ id: "t1", name: "T", role: "Assistant", phone: "555", email: "t@x" }],
  staff_notes: [{ id: "n1", employee_id: 2, shared_note: "s", private_note: "PRIVATE" }],
  login_attempts: [],
};
let countResult = 0;
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls.push({ method: req.method!, url: decodeURIComponent(req.url!), body, headers: req.headers });
    const table = req.url!.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    res.setHeader("Content-Type", "application/json");
    if (req.method === "HEAD") { res.setHeader("Content-Range", `0-0/${countResult}`); res.end(); return; }
    if (req.method === "GET") {
      const accept = String(req.headers.accept ?? "");
      const rows = canned[table] ?? [];
      res.setHeader("Content-Range", `0-${rows.length}/${countResult}`);
      res.end(JSON.stringify(accept.includes("vnd.pgrst.object") ? rows[0] ?? null : rows)); return;
    }
    if (req.method === "DELETE") { res.statusCode = 204; res.end(); return; }
    const parsed = body ? JSON.parse(body) : {};
    res.statusCode = 201;
    res.end(JSON.stringify(Array.isArray(parsed) ? parsed : [parsed]));
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(54329, r));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54329";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.SESSION_SECRET = "test-secret";
  process.env.SUPER_PASSCODE = "999111";
  const { createSessionToken } = await import("../src/lib/session");
  const { POST } = await import("../src/app/api/secure-data/route");
  const { NextRequest } = await import("next/server");

  const staffTok = createSessionToken({ mode: "staff", employeeId: 2, employeeName: "B", canAdmin: false, canManageLeave: false, canManageEvents: false, canManageCerts: false, canManagePayroll: false, canManageStaffNotes: false });
  const payTok = createSessionToken({ mode: "staff", employeeId: 3, employeeName: "C", canAdmin: false, canManageLeave: false, canManageEvents: false, canManageCerts: false, canManagePayroll: true, canManageStaffNotes: false });

  let failures = 0;
  async function call(name: string, spec: any, token: string | null, expectStatus: number, check?: (json: any, last: any) => string | null) {
    const before = calls.length;
    const req = new NextRequest("http://localhost/api/secure-data", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify({ filters: [], order: [], ...spec }) });
    const res = await POST(req);
    const json = await res.json();
    const made = calls.slice(before);
    let problem = res.status !== expectStatus ? `status ${res.status} (wanted ${expectStatus}) ${JSON.stringify(json)}` : null;
    if (!problem && check) problem = check(json, made);
    console.log(`${problem ? "FAIL" : "ok  "} ${name}${problem ? " — " + problem : ""}`);
    if (problem) failures++;
  }

  await call("anon reads staff: pin and email stripped", { table: "staff", action: "select", columns: "*" }, null, 200,
    (j) => (j.data[0].pin || j.data[0].email || j.data[0].pto_balance_hours != null ? "leaked " + JSON.stringify(j.data[0]) : j.data[0].name === "A" ? null : "missing name"));
  await call("staff session reads staff: pin stripped, email kept", { table: "staff", action: "select" }, staffTok, 200,
    (j) => (j.data[0].pin ? "pin leaked" : j.data[0].email ? null : "email missing"));
  await call("filter on pin refused", { table: "staff", action: "select", filters: [{ column: "pin", op: "eq", value: "1234" }] }, staffTok, 403);
  await call("embedded select refused", { table: "leave_requests", action: "select", columns: "*, staff(pin)" }, staffTok, 400);
  await call("anon cannot read payroll", { table: "payroll_entries", action: "select" }, null, 401);
  await call("bad token -> 401", { table: "staff", action: "select" }, staffTok + "x", 401);
  await call("staff reads payroll: forced to own person_key", { table: "payroll_entries", action: "select", filters: [{ column: "person_key", op: "eq", value: "staff:9" }] }, staffTok, 200,
    (_j, m) => (m.some((c: any) => c.url.includes("person_key=eq.staff:2")) && !m.some((c: any) => c.url.includes("staff:9")) ? null : "filter not forced: " + m.map((c: any) => c.url).join(" ")));
  await call("staff cannot read cash accounts", { table: "cash_accounts", action: "select" }, staffTok, 403);
  await call("payroll manager reads cash accounts", { table: "cash_accounts", action: "select" }, payTok, 200);
  await call("anon leave: notes/reason stripped", { table: "leave_requests", action: "select" }, null, 200,
    (j) => (j.data.some((r: any) => r.notes || r.reason) ? "leaked" : null));
  await call("staff leave: own row full, others redacted", { table: "leave_requests", action: "select" }, staffTok, 200,
    (j) => { const mine = j.data.find((r: any) => r.employee_id === 2), other = j.data.find((r: any) => r.employee_id === 1); return mine.notes === "mine" && !other.notes ? null : JSON.stringify(j.data); });
  await call("staff notes: forced own + private stripped", { table: "staff_notes", action: "select" }, staffTok, 200,
    (j, m) => (j.data[0].private_note ? "private leaked" : m.some((c: any) => c.url.includes("employee_id=eq.2")) ? null : "not forced"));
  await call("staff cannot filter staff_notes on private_note", { table: "staff_notes", action: "select", filters: [{ column: "private_note", op: "like", value: "%a%" }] }, staffTok, 403);
  await call("anon temps: phone stripped", { table: "temps", action: "select" }, null, 200, (j) => (j.data[0].phone ? "phone leaked" : null));
  await call("anon cannot write", { table: "holidays", action: "insert", payload: { date: "2026-01-01" } }, null, 401);
  await call("staff cannot write holidays", { table: "holidays", action: "insert", payload: { date: "2026-01-01" } }, staffTok, 403);
  await call("staff submits own leave", { table: "leave_requests", action: "insert", payload: { id: "x", employee_id: 2, status: "pending" } }, staffTok, 200);
  await call("staff cannot submit leave for someone else", { table: "leave_requests", action: "insert", payload: { id: "x", employee_id: 1, status: "pending" } }, staffTok, 403);
  await call("staff cannot self-approve", { table: "leave_requests", action: "insert", payload: { id: "x", employee_id: 2, status: "approved" } }, staffTok, 403);
  await call("staff cancel adds own+pending filters", { table: "leave_requests", action: "update", payload: { status: "cancelled" }, filters: [{ column: "id", op: "eq", value: "l1" }] }, staffTok, 200,
    (_j, m) => (m.some((c: any) => c.method === "PATCH" && c.url.includes("employee_id=eq.2") && c.url.includes("status=eq.pending")) ? null : m.map((c: any) => c.url).join(" ")));
  await call("staff cannot approve via update", { table: "leave_requests", action: "update", payload: { status: "approved" }, filters: [{ column: "id", op: "eq", value: "l1" }] }, staffTok, 403);
  await call("delete without filter refused", { table: "cash_accounts", action: "delete" }, payTok, 400);
  await call("unknown op refused", { table: "cash_accounts", action: "delete", filters: [{ column: "id", op: "ilike", value: "%" }] }, payTok, 400);
  await call("hidden column in payload refused", { table: "staff", action: "update", payload: { pin: "1" }, filters: [{ column: "id", op: "eq", value: 1 }] }, payTok, 403);
  await call("staff claims slot: forced is-null filter", { table: "checkin_slots", action: "update", payload: { claimed_by_employee_id: 2, claimed_by_name: "Z", notes: "" }, filters: [{ column: "id", op: "eq", value: "s" }] }, staffTok, 200,
    (_j, m) => { const p = m.find((c: any) => c.method === "PATCH"); return p && p.url.includes("claimed_by_employee_id=is.null") && JSON.parse(p.body).claimed_by_name === "B" ? null : "bad " + JSON.stringify(p); });
  await call("staff cannot claim slot for someone else", { table: "checkin_slots", action: "update", payload: { claimed_by_employee_id: 1, claimed_by_name: "A" }, filters: [{ column: "id", op: "eq", value: "s" }] }, staffTok, 403);
  await call("rsvp own ok", { table: "event_rsvps", action: "upsert", payload: { event_id: "e", employee_id: 2, attending: true }, onConflict: "event_id,employee_id" }, staffTok, 200);
  await call("rsvp with explicit id refused", { table: "event_rsvps", action: "upsert", payload: { id: "other", event_id: "e", employee_id: 2 } }, staffTok, 403);
  await call("upsert ignoreDuplicates passes through", { table: "schedules", action: "upsert", payload: { date: "2026-01-05" }, onConflict: "date", ignoreDuplicates: true },
    createSessionToken({ mode: "super", canAdmin: true, canManageLeave: true, canManageEvents: true, canManageCerts: true, canManagePayroll: true, canManageStaffNotes: true }), 200,
    (_j, m) => (String(m[m.length - 1].headers.prefer).includes("ignore-duplicates") ? null : "prefer=" + m[m.length - 1].headers.prefer));
  await call("unknown table refused", { table: "login_attempts", action: "select" }, payTok, 403);

  // ---- login & change-pin
  const login = (await import("../src/app/api/auth/login/route")).POST;
  const lreq = (code: string) => new NextRequest("http://localhost/api/auth/login", { method: "POST", headers: { "x-real-ip": "1.2.3.4" }, body: JSON.stringify({ code }) });
  canned.staff = [{ id: 1, name: "A", pin: "1234", archived: false }];
  countResult = 0;
  let r = await (await login(lreq("1234"))).json();
  console.log(r.ok && r.pinNeedsUpdate ? "ok   4-digit login works and asks for update" : "FAIL login " + JSON.stringify(r)); if (!(r.ok && r.pinNeedsUpdate)) failures++;
  canned.staff = [{ id: 1, name: "A", pin: "1234" }, { id: 2, name: "B", pin: "1234" }];
  r = await (await login(lreq("1234"))).json();
  console.log(!r.ok && /shared/.test(r.error) ? "ok   duplicate PIN refused" : "FAIL dup " + JSON.stringify(r)); if (r.ok) failures++;
  countResult = 8;
  const lr = await login(lreq("0000"));
  console.log(lr.status === 429 ? "ok   rate limited after 8 failures" : "FAIL rate limit " + lr.status); if (lr.status !== 429) failures++;
  countResult = 0;

  const cp = (await import("../src/app/api/auth/change-pin/route")).POST;
  const cpreq = (body: any) => new NextRequest("http://localhost/api/auth/change-pin", { method: "POST", headers: { "x-session-token": staffTok }, body: JSON.stringify(body) });
  canned.staff = [{ id: 2, pin: "1234" }];
  let cr = await cp(cpreq({ currentPin: "9999", newPin: "482913" }));
  console.log(cr.status === 403 ? "ok   wrong current PIN refused" : "FAIL " + cr.status); if (cr.status !== 403) failures++;
  cr = await cp(cpreq({ currentPin: "1234", newPin: "12345" }));
  console.log(cr.status === 400 ? "ok   5-digit new PIN refused" : "FAIL " + cr.status); if (cr.status !== 400) failures++;
  canned.staff = [{ id: 2, pin: "1234" }];
  // pinProblem's uniqueness lookup returns canned staff (non-empty) => "taken"
  cr = await cp(cpreq({ currentPin: "1234", newPin: "482913" }));
  const cj = await cr.json();
  console.log(cr.status === 400 && /available/.test(cj.error) ? "ok   PIN already in use refused" : "FAIL " + cr.status + JSON.stringify(cj)); if (cr.status !== 400) failures++;

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
main();
