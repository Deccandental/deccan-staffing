// One set of "is this number overdue?" rules for the whole Cash Flow area.
// The Weekly Update lines, the tab's red flag, the Overview banner and the
// weekly digest email all call these, so they can't disagree.
//
//   Weekly   — bank balances, card current balances, Open Dental numbers, A/R
//   Monthly  — loan current balances (about 35 days), and every statement
//              balance (flagged once the newest one on file is older than the
//              month it should cover)
//
// A statement is only chased once one has been entered for that account,
// card or loan, so something that isn't tracked isn't nagged about.

export const WEEKLY_DAYS = 7;
export const MONTHLY_DAYS = 35;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" → "Sep ’26" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
}

function parseWhen(when: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(when) ? new Date(when + "T00:00:00") : new Date(when);
}

export function daysSince(when: string | null | undefined, now: number = Date.now()): number {
  if (!when) return Infinity;
  return (now - parseWhen(when).getTime()) / 86400000;
}

/** Last calendar month as YYYY-MM — the statement a bank or loan has just issued. */
export function previousMonth(now: Date = new Date()): string {
  const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The month the most recently closed statement covers. A card that closes on
 * the 12th is, on Oct 2, still on its September statement. Pass null for
 * banks and loans, which are treated as closing at month end (so: last month).
 */
export function coveredMonth(closingDay: number | null, now: Date = new Date()): string {
  if (closingDay == null) return previousMonth(now);
  let y = now.getFullYear();
  let m = now.getMonth(); // 0-based
  if (now.getDate() < (closingDay || 1)) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export type Cadence = "weekly" | "monthly";

/** Warnings for a current balance. [] when it's fresh enough. */
export function balanceWarnings(checkedAt: string | null | undefined, cadence: Cadence, now: number = Date.now()): string[] {
  const limit = cadence === "weekly" ? WEEKLY_DAYS : MONTHLY_DAYS;
  if (!checkedAt) return [`Current balance has no update logged yet — update ${cadence}`];
  const d = daysSince(checkedAt, now);
  if (d >= limit) return [`Current balance last updated ${Math.floor(d)} days ago — update ${cadence}`];
  return [];
}

/** Warnings for a statement balance. latestMonth is the newest entry on file, or null if none. */
export function statementWarnings(latestMonth: string | null | undefined, covered: string): string[] {
  if (!latestMonth) return []; // never tracked — don't nag
  if (latestMonth < covered) return [`${monthLabel(covered)} statement balance not entered yet — update monthly`];
  return [];
}

/** Warnings for a weekly manual entry (Open Dental numbers, A/R). */
export function weeklyEntryWarnings(when: string | null | undefined, now: number = Date.now()): string[] {
  if (!when) return ["Never entered — update weekly"];
  const d = daysSince(when, now);
  if (d >= WEEKLY_DAYS) return [`Last entered ${Math.floor(d)} days ago — update weekly`];
  return [];
}

export function newestMonth(entries: { month: string }[] | undefined | null): string | null {
  if (!entries || entries.length === 0) return null;
  return entries.reduce((best, e) => (e.month > best ? e.month : best), entries[0].month);
}

// ---------------- Whole-page rollup ----------------

export interface StaleInput {
  accounts: { id: string; name: string }[];
  cards: { id: string; name: string; approxClosingDay: number }[];
  loans: { id: string; name: string }[];
  /** latest current-balance check time, keyed by account / card / loan name */
  latestChecked: Record<string, string | undefined>;
  /** statement entries, keyed by account / card / loan id */
  statements: Record<string, { month: string }[] | undefined>;
  reviewDate: string | null;
  arDate: string | null;
  now?: Date;
}

export interface StaleItem { name: string; warnings: string[] }

/** Everything on the Weekly Update tab that is currently overdue. */
export function buildStaleItems(i: StaleInput): StaleItem[] {
  const now = i.now ?? new Date();
  const t = now.getTime();
  const items: StaleItem[] = [];
  const add = (name: string, warnings: string[]) => { if (warnings.length > 0) items.push({ name, warnings }); };

  for (const a of i.accounts) {
    add(a.name, [
      ...balanceWarnings(i.latestChecked[a.name], "weekly", t),
      ...statementWarnings(newestMonth(i.statements[a.id]), coveredMonth(null, now)),
    ]);
  }
  for (const c of i.cards) {
    add(c.name, [
      ...balanceWarnings(i.latestChecked[c.name], "weekly", t),
      ...statementWarnings(newestMonth(i.statements[c.id]), coveredMonth(c.approxClosingDay, now)),
    ]);
  }
  for (const l of i.loans) {
    add(l.name, [
      ...balanceWarnings(i.latestChecked[l.name], "monthly", t),
      ...statementWarnings(newestMonth(i.statements[l.id]), coveredMonth(null, now)),
    ]);
  }
  add("Open Dental numbers", weeklyEntryWarnings(i.reviewDate, t));
  add("A/R aging", weeklyEntryWarnings(i.arDate, t));
  return items;
}
