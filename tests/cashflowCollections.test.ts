// Expected collections in the cash outlook: the 14-day forecast used to count $0 coming in.
// Run: npx --yes tsx --tsconfig tsconfig.json tests/cashflowCollections.test.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:9";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test";
import assert from "node:assert/strict";
import {
  estimateDailyCollections, collectionsAccountId, buildExpectedCollections, buildOccurrences, computeAccountForecast,
  type WeeklyCashReview, type CashAccount, type RecurringBill,
} from "@/lib/cashflow";

const review = (reviewDate: string, currentIncome: number | null): WeeklyCashReview =>
  ({ id: reviewDate, reviewDate, projectedTotalProduction: null, currentIncome, currentPatientIncome: null, notes: "" });
const acct = (id: string, cushionTarget: number): CashAccount =>
  ({ id, name: id, cushionTarget, sortOrder: 0, statementBalance: 0, statementBalanceUpdatedAt: null, active: true });
const bill = (p: Partial<RecurringBill>): RecurringBill => ({
  id: p.name ?? "b", name: "b", estimatedAmount: 0, frequency: "monthly", anchorDate: "2026-01-01", category: "bill",
  active: true, cashAccountId: null, direction: "outflow", essential: true, ...p,
});

// Each month's latest review, income ÷ day of month; first-week reviews and old months ignored.
{
  const reviews = [
    review("2026-11-23", 109747.89), review("2026-11-13", 64135.94),
    review("2026-10-29", 136017.42), review("2026-10-02", 7882.55),
    review("2026-09-30", 123232.96), review("2026-08-30", 999999), review("2026-12-02", 50),
  ];
  const rate = estimateDailyCollections(reviews, "2026-11-26")!;
  const expected = (109747.89 / 23 + 136017.42 / 29 + 123232.96 / 30) / 3;
  assert.ok(Math.abs(rate - expected) < 0.01, `rate ${rate} vs ${expected}`);
  assert.equal(estimateDailyCollections([review("2026-11-03", 5000)], "2026-11-26"), null);
  assert.equal(estimateDailyCollections([], "2026-11-26"), null);
}

// Deposits land in the payroll account, and not at all once deposits are scheduled by hand.
{
  const accounts = [acct("chase", 3000), acct("53", 10000)];
  const bills = [bill({ name: "Dental Billing", cashAccountId: "chase", estimatedAmount: 50000 }), bill({ name: "Payroll", category: "payroll", cashAccountId: "53", estimatedAmount: 30000 })];
  assert.equal(collectionsAccountId(accounts, bills), "53");
  assert.equal(collectionsAccountId(accounts, [...bills, bill({ name: "Deposit", direction: "inflow", cashAccountId: "chase", estimatedAmount: 1 })]), null);
  assert.equal(collectionsAccountId(accounts, []), null);
}

// Business days only; two full weeks add up to 14 days of collections.
{
  const occ = buildExpectedCollections("53", 1000, "2026-11-29", 14); // a Sunday: Mon Nov 30 – Sun Dec 13
  assert.equal(occ.length, 10);
  assert.ok(occ.every((o) => o.direction === "inflow" && o.cashAccountId === "53"));
  assert.ok(Math.abs(occ.reduce((s, o) => s + o.amount, 0) - 14000) < 0.5);
  assert.deepEqual(buildExpectedCollections("53", 0, "2026-11-29", 14), []);
}

// The forecast now counts them: same bills, balance and cushion, positive instead of short.
{
  const a = acct("53", 10000);
  const bills = [bill({ name: "Payroll", category: "payroll", cashAccountId: "53", estimatedAmount: 60000, anchorDate: "2026-01-05" })];
  const occ = buildOccurrences(bills, [], "2026-11-01", "2026-12-10");
  const before = computeAccountForecast(a, 66660, occ, "2026-11-26", 0);
  assert.equal(before.expectedDeposits14d, 0);
  assert.ok(before.excessOrShortfall < 0);
  const after = computeAccountForecast(a, 66660, [...occ, ...buildExpectedCollections("53", 4500, "2026-11-26", 14)], "2026-11-26", 0);
  assert.ok(after.expectedDeposits14d > 55000 && after.expectedDeposits14d < 70000, String(after.expectedDeposits14d));
  assert.ok(after.excessOrShortfall > 0);
}

console.log("cashflow collections: all checks passed");
