import { Employee } from "@/types/employee";
import { loadHoBonusPayoutYear, loadHoBonusPayments } from "@/lib/hoBonus";
import { loadAllPvBonusQuarters, loadPvBonusPayrollEntries, loadPvBonusPayments, computePvQuarterCalcs, getPvQuarterDateRange } from "@/lib/pvBonus";
import { loadHygieneBonusEntries, getPayPeriodsInYear, HYGIENE_BONUS_PER_PATIENT, isHygieneBonusEligible } from "@/lib/hygieneBonus";
import { loadPayrollEntriesInRange } from "@/lib/payrollStore";
import { loadGrowthBonusQuarter, computeQuarterCalc, loadGrowthBonusPayments, getQuarterDateRange } from "@/lib/growthBonus";
import { loadBonusCarryovers, carryKey } from "@/lib/bonusCarryover";

/**
 * What the practice owes in compensation and bonuses right now, so the cash
 * the month needs includes it. Everything here is meant to be paid as it is
 * calculated, so each item is "calculated to date, less paid to date".
 *
 *  - Dr. Ho: 40% of net production, through the current month. It is her
 *    compensation, not a discretionary bonus. Payments are matched the way the
 *    Payroll page matches them: a month's payments are the ones dated in that
 *    month, across her payout year (December of last year onward).
 *  - PV, staff growth bonus, hygiene bonus: a typed-in balance carried from
 *    before the app's records (Numbers tab), plus everything the app calculates
 *    from the start of that balance's year, less payments made since.
 *      PV: each ended quarter's bonus (usually paid about a month into the next
 *          quarter).
 *      Growth: each ended quarter's pool.
 *      Hygiene: patients x $15 per pay period.
 *
 * Bonus money added to a payroll run is routed into each programme's own
 * payment records (see bonusRouting.ts), and this reads those same records, so
 * paying someone through payroll reduces what is owed here automatically.
 *
 * Someone who has been paid ahead never reduces what else is owed: the item
 * is floored at $0 and the overpayment is noted in its detail.
 */

export interface CompOwedItem { label: string; detail: string; amount: number }
export interface CompOwedResult { items: CompOwedItem[]; total: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
const carriedText = (amount: number, year: number) =>
  Math.abs(amount) > 0.5 ? `; ${amount > 0 ? money(amount) : `${money(-amount)} paid ahead`} carried in from before ${year}` : "";

/** The most recent quarter that has fully ended as of `today`. */
function lastEndedQuarter(today: string): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const cur = Math.ceil(m / 3);
  return cur === 1 ? { year: y - 1, quarter: 4 } : { year: y, quarter: (cur - 1) as 1 | 2 | 3 | 4 };
}

export async function loadCompOwed(staff: Employee[], today: string = new Date().toISOString().slice(0, 10)): Promise<CompOwedResult> {
  const items: CompOwedItem[] = [];
  const active = staff.filter((s) => !s.archived);
  const year = Number(today.slice(0, 4));
  const thisMonth = today.slice(0, 7);
  const carry = await loadBonusCarryovers();

  // ---- Dr. Ho compensation ----
  for (const e of active.filter((s) => s.hoBonusEligible)) {
    const [months, payments] = await Promise.all([loadHoBonusPayoutYear(e.id, year), loadHoBonusPayments(e.id)]);
    const counted = months.filter((m) => ym(m.year, m.month) <= thisMonth);
    const earned = counted.reduce((sum, m) => sum + m.production * 0.4, 0);
    const first = counted.length ? ym(counted[0].year, counted[0].month) : thisMonth;
    const paid = payments.filter((p) => { const k = p.datePaid.slice(0, 7); return k >= first && k <= thisMonth; }).reduce((sum, p) => sum + p.amount, 0);
    const balance = earned - paid;
    const through = counted.length ? `${MONTHS[counted[counted.length - 1].month - 1]}` : MONTHS[Number(thisMonth.slice(5)) - 1];
    if (earned > 0 || paid > 0) {
      items.push({
        label: "Dr. Ho compensation",
        detail: `40% of net production through ${through}: ${money(earned)} earned, ${money(paid)} paid${balance < 0 ? ` — paid ahead by ${money(-balance)}` : ""}`,
        amount: Math.max(0, balance),
      });
    }
  }

  // ---- PV net production bonus ----
  const q = lastEndedQuarter(today);
  for (const e of active.filter((s) => s.pvBonusEligible)) {
    const [quarters, entries, payments] = await Promise.all([loadAllPvBonusQuarters(e.id), loadPvBonusPayrollEntries(e.id), loadPvBonusPayments(e.id)]);
    const c = carry.get(carryKey("pv", e.id));
    const startYear = c?.asOfYear ?? year;
    const prior = c?.amount ?? 0;
    const percent = e.netProductionBonusPercent ?? 30;
    const endedQuarters = computePvQuarterCalcs(quarters.filter((x) => x.year >= startYear), entries, payments, percent)
      .filter((x) => getPvQuarterDateRange(x.year, x.quarter).end < today);
    const earned = endedQuarters.reduce((sum, x) => sum + x.bonus, 0);
    const paid = payments.filter((p) => p.datePaid >= `${startYear}-01-01`).reduce((sum, p) => sum + p.amount, 0);
    const balance = prior + earned - paid;
    if (earned > 0 || paid > 0 || Math.abs(prior) > 0.5) {
      items.push({
        label: `${e.name} net production bonus`,
        detail: `${endedQuarters.length} ended quarter${endedQuarters.length === 1 ? "" : "s"} since ${startYear}: ${money(earned)} earned, ${money(paid)} paid${carriedText(prior, startYear)}${balance < 0 ? ` — paid ahead by ${money(-balance)}` : ""}; usually paid about a month into the next quarter`,
        amount: Math.max(0, balance),
      });
    }
  }

  // ---- Staff growth bonus ----
  if (active.some((s) => s.growthBonusEligible)) {
    const c = carry.get(carryKey("growth", 0));
    const startYear = c?.asOfYear ?? year;
    const prior = c?.amount ?? 0;
    const quarterKeys: { year: number; quarter: 1 | 2 | 3 | 4 }[] = [];
    for (let y = startYear; y <= q.year; y++) {
      for (const qq of [1, 2, 3, 4] as const) {
        if (y === q.year && qq > q.quarter) break;
        quarterKeys.push({ year: y, quarter: qq });
      }
    }
    const pools = await Promise.all(quarterKeys.map(async (k) => computeQuarterCalc(await loadGrowthBonusQuarter(k.year, k.quarter)).bonusPool));
    const earned = pools.reduce((sum, p) => sum + p, 0);
    const payments = await loadGrowthBonusPayments();
    const paid = payments.filter((p) => p.date >= `${startYear}-01-01`).reduce((sum, p) => sum + p.amount, 0);
    const balance = prior + earned - paid;
    if (earned > 0 || paid > 0 || Math.abs(prior) > 0.5) {
      items.push({
        label: "Staff growth bonus",
        detail: `Since ${startYear}: ${money(earned)} earned, ${money(paid)} paid${carriedText(prior, startYear)}${balance < 0 ? ` — paid ahead by ${money(-balance)}` : ""}`,
        amount: Math.max(0, balance),
      });
    }
  }

  // ---- Hygiene bonus ----
  const hygienists = active.filter((e) => isHygieneBonusEligible(e));
  for (const e of hygienists) {
    const c = carry.get(carryKey("hygiene", e.id));
    const startYear = c?.asOfYear ?? year;
    const prior = c?.amount ?? 0;
    let earned = 0, paid = 0;
    for (let y = startYear; y <= year; y++) {
      const yr = await hygieneYear(e.id, y, today);
      earned += yr.earned; paid += yr.paid;
    }
    const balance = prior + earned - paid;
    if (earned > 0 || paid > 0 || Math.abs(prior) > 0.5) {
      items.push({
        label: `${e.name} hygiene bonus`,
        detail: `Since ${startYear}: ${money(earned)} earned, ${money(paid)} paid${carriedText(prior, startYear)}${balance < 0 ? ` — paid ahead by ${money(-balance)}` : ""}`,
        amount: Math.max(0, balance),
      });
    }
  }

  return { items, total: items.reduce((sum, i) => sum + i.amount, 0) };
}

export interface HygienePeriodRow { start: string; label: string; payDate: string; patients: number; earned: number; paid: number }

/**
 * One hygienist's pay periods for one calendar year, as the Hygiene Bonus
 * sheet works them out: patients (a saved count, else the Payroll row's hygiene
 * count), earned = patients x $15, and what has been paid against the period.
 */
export async function hygieneYearDetail(employeeId: number, y: number): Promise<HygienePeriodRow[]> {
  const [payroll, overrides] = await Promise.all([
    loadPayrollEntriesInRange(`${y}-01-01`, `${y}-12-31`),
    loadHygieneBonusEntries(employeeId, `${y}-01-01`, `${y}-12-31`),
  ]);
  const byStart = new Map(overrides.map((o) => [o.payPeriodStart, o]));
  return getPayPeriodsInYear(y).map((p) => {
    const o = byStart.get(p.start);
    const row = payroll.find((r) => r.personKey === `staff:${employeeId}` && r.payPeriodStart === p.start);
    const patients = o?.patientCount ?? row?.hygienePatientCount ?? 0;
    return { start: p.start, label: p.label, payDate: p.payDate, patients, earned: patients * HYGIENE_BONUS_PER_PATIENT, paid: o?.amountPaid ?? 0 };
  });
}

/** Earned and paid for one year, counting periods that have started by `cutoff`. */
export async function hygieneYear(employeeId: number, y: number, cutoff: string): Promise<{ earned: number; paid: number }> {
  const rows = await hygieneYearDetail(employeeId, y);
  let earned = 0, paid = 0;
  for (const r of rows) {
    if (r.start <= cutoff) earned += r.earned;
    // Payments logged against a period that hasn't started yet still count as paid.
    paid += r.paid;
  }
  return { earned, paid };
}
