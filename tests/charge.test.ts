// Checks the charge-assistant rotation (pure parts only).
//   npx --yes tsx --tsconfig tsconfig.json tests/charge.test.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:9";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, detail ?? ""); }
}

async function main() {
  const { planCharges, pickCharge } = await import("../src/lib/charge");
  const day = (i: number) => `2027-01-${String(i + 1).padStart(2, "0")}`;
  const plan = (date: string, ids: number[], halfOffIds: number[] = []) =>
    ({ date, isOpen: true, content: null, absences: [], workingIds: ids, chargeCandidates: ids, halfOffIds }) as any;
  const counts = (rows: { employee_id: number }[]) => rows.reduce((m, r) => ({ ...m, [r.employee_id]: (m[r.employee_id] ?? 0) + 1 }), {} as Record<number, number>);

  console.log("everyone in every day");
  let rows = planCharges(Array.from({ length: 20 }, (_, i) => plan(day(i), [1, 2, 3, 4])), [], new Map());
  check("one charge per day", rows.length === 20);
  check("equal turns (5 each)", JSON.stringify(counts(rows)) === JSON.stringify({ 1: 5, 2: 5, 3: 5, 4: 5 }), counts(rows));
  check("in sequence", rows.slice(0, 8).map((r) => r.employee_id).join("") === "12341234", rows.map((r) => r.employee_id).join(""));
  check("never twice in a row", rows.every((r, i) => i === 0 || r.employee_id !== rows[i - 1].employee_id));

  console.log("someone only in on some days");
  const plans = Array.from({ length: 30 }, (_, i) => plan(day(i), i % 3 === 0 ? [1, 2, 3] : [1, 2]));
  rows = planCharges(plans, [], new Map());
  check("only people who are in", rows.every((r, i) => plans[i].chargeCandidates.includes(r.employee_id)));
  check("never twice in a row", rows.every((r, i) => i === 0 || r.employee_id !== rows[i - 1].employee_id));
  const c = counts(rows);
  check("part-timer gets a fair share of their days", c[3] >= 6, c);

  console.log("only one assistant in");
  rows = planCharges([plan(day(0), [1, 2]), plan(day(1), [1]), plan(day(2), [1])], [], new Map());
  check("they're in charge even two days running", rows.map((r) => r.employee_id).join("") === "111" || rows[1].employee_id === 1 && rows[2].employee_id === 1, rows);

  console.log("history and stability");
  rows = planCharges([plan(day(10), [1, 2, 3])], [{ date: day(0), employee_id: 1, manual: false }, { date: day(1), employee_id: 2, manual: false }], new Map());
  check("whoever never had a turn goes first", rows[0].employee_id === 3, rows);
  const stored = new Map([[day(10), { date: day(10), employee_id: 2, manual: false }]]);
  rows = planCharges([plan(day(10), [1, 2, 3])], [], stored);
  check("a decided day stays put", rows[0].employee_id === 2, rows);
  rows = planCharges([plan(day(10), [1, 3])], [], stored);
  check("…unless that person is no longer in", rows[0].employee_id !== 2, rows);
  rows = planCharges([plan(day(0), [1, 2]), plan(day(1), [1, 2])], [], new Map([[day(1), { date: day(1), employee_id: 1, manual: true }]]));
  check("a hand pick is kept, even twice in a row", rows[1].employee_id === 1 && rows[1].manual, rows);

  console.log("half days");
  check("half-day person skipped if someone else is in", pickCharge([1, 2], new Map(), new Map(), null, new Set([1])) === 2);
  check("…but used if they're the only one", pickCharge([1], new Map(), new Map(), null, new Set([1])) === 1);

  console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
