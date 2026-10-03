import { Employee } from "@/types/employee";
import { loadHoBonusPayoutYear, loadHoBonusPayments } from "@/lib/hoBonus";
import { loadAllPvBonusQuarters, loadPvBonusPayrollEntries, loadPvBonusPayments, computePvQuarterCalcs, getPvQuarterDateRange } from "@/lib/pvBonus";
import { loadHygieneBonusEntries, getPayPeriodsInYear, HYGIENE_BONUS_PER_PATIENT } from "@/lib/hygieneBonus";
import { loadPayrollEntriesInRange } from "@/lib/payrollStore";
import { loadGrowthBonusQuarter, computeQuarterCalc, loadGrowthBonusPayments, getQuarterDateRange } from "@/lib/growthBonus";

/**
 * What the practice owes in compensation and bonuses right now, so the cash
 * the month needs includes it. Everything here is meant to be paid as it is
 * calculated, so each item is "calculated to date, less paid to date".
 *
 *  - Dr. Ho: 40% of net production, through the current month. It is her
 *    compensation, not a discretionary bonus. Payments are matched the way the
 *    Payroll page matches them: a month's payments are the ones dated in that
 *    month, across her payout year (December of last year onward).
 *  - PV: the running net-production-bonus balance through the last quarter
 *    that has ended. It is usually paid about a month into the next quarter.
 *  - Staff growth bonus: every ended quarter's pool (up to three years back),
 *    less payments made since the first of those quarters ended, so an unpaid
 *    earlier quarter carries forward.
 *  - Hygiene bonus: patients x $15 across this year's pay periods plus any
 *    balance carried from the previous three years, less what has been paid.
 *  - PV's running balance already carries every earlier quarter forward.
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

  // ---- PV net production bonus (running balance through the last ended quarter) ----
  const q = lastEndedQuarter(today);
  for (const e of active.filter((s) => s.pvBonusEligible)) {
    const [quarters, entries, payments] = await Promise.all([loadAllPvBonusQuarters(e.id), loadPvBonusPayrollEntries(e.id), loadPvBonusPayments(e.id)]);
    const percent = e.netProductionBonusPercent ?? 30;
    const ended = computePvQuarterCalcs(quarters, entries, payments, percent)
      .filter((c) => getPvQuarterDateRange(c.year, c.quarter).end < today);
    const last = ended[ended.length - 1];
    if (last) {
      // Payroll files a payment under the quarter it was PAID in, so paying Q3's
      // bonus in October lands in Q4's column. Take those later payments off the
      // balance at the end of Q3, or a bonus that has been paid would still show.
      const end = getPvQuarterDateRange(last.year, last.quarter).end;
      const paidSince = payments.filter((p) => p.datePaid > end).reduce((sum, p) => sum + p.amount, 0);
      const balance = last.balance - paidSince;
      items.push({
        label: `${e.name} net production bonus`,
        detail: `Q${last.quarter} ’${String(last.year).slice(2)} running balance ${money(last.balance)}, ${money(paidSince)} paid since the quarter ended${balance < 0 ? ` — paid ahead by ${money(-balance)}` : ""}; usually paid about a month into the next quarter`,
        amount: Math.max(0, balance),
      });
    }
  }

  // ---- Staff growth bonus: every ended quarter's pool (carried forward), less payments since ----
  if (active.some((s) => s.growthBonusEligible)) {
    const LOOKBACK_YEARS = 3;
    const quarterKeys: { year: number; quarter: 1 | 2 | 3 | 4 }[] = [];
    for (let y = q.year - LOOKBACK_YEARS; y <= q.year; y++) {
      for (const qq of [1, 2, 3, 4] as const) {
        if (y === q.year && qq > q.quarter) break;
        quarterKeys.push({ year: y, quarter: qq });
      }
    }
    const pools = await Promise.all(quarterKeys.map(async (k) => ({ ...k, pool: computeQuarterCalc(await loadGrowthBonusQuarter(k.year, k.quarter)).bonusPool })));
    const withPool = pools.filter((p) => p.pool > 0);
    if (withPool.length > 0) {
      const earned = withPool.reduce((sum, p) => sum + p.pool, 0);
      // Nothing can be paid before the first pool exists, so payments from the end of
      // that first quarter onward are what count against the pools.
      const firstEnd = getQuarterDateRange(withPool[0].year, withPool[0].quarter).end;
      const payments = await loadGrowthBonusPayments();
      const paid = payments.filter((p) => p.date > firstEnd).reduce((sum, p) => sum + p.amount, 0);
      const balance = earned - paid;
      const lastPool = withPool[withPool.length - 1];
      items.push({
        label: "Staff growth bonus",
        detail: `${withPool.length === 1 ? `Q${lastPool.quarter} ’${String(lastPool.year).slice(2)}` : `${withPool.length} quarters since Q${withPool[0].quarter} ’${String(withPool[0].year).slice(2)}`}: ${money(earned)} earned, ${money(paid)} paid${balance < 0 ? ` — paid ahead by ${money(-balance)}` : ""}`,
        amount: Math.max(0, balance),
      });
    }
  }

  // ---- Hygiene bonus: this year plus any balance carried from earlier years ----
  const hygienists = active.filter((e) => e.role === "Hygienist" || (e.skills ?? []).includes("Hygienist"));
  if (hygienists.length > 0) {
    const LOOKBACK_YEARS = 3;
    const years: number[] = [];
    for (let y = year - LOOKBACK_YEARS; y <= year; y++) years.push(y);
    // One query per year keeps each well under the row limit.
    const payrollByYear = await Promise.all(years.map((y) => loadPayrollEntriesInRange(`${y}-01-01`, `${y}-12-31`)));
    for (const e of hygienists) {
      let carried = 0, earnedNow = 0, paidNow = 0;
      for (let i = 0; i < years.length; i++) {
        const y = years[i];
        const overrides = await loadHygieneBonusEntries(e.id, `${y}-01-01`, `${y}-12-31`);
        const byStart = new Map(overrides.map((o) => [o.payPeriodStart, o]));
        let earned = 0, paid = 0;
        for (const p of getPayPeriodsInYear(y).filter((pp) => pp.start <= today)) {
          const o = byStart.get(p.start);
          const row = payrollByYear[i].find((r) => r.personKey === `staff:${e.id}` && r.payPeriodStart === p.start);
          earned += (o?.patientCount ?? row?.hygienePatientCount ?? 0) * HYGIENE_BONUS_PER_PATIENT;
          paid += o?.amountPaid ?? 0;
        }
        // Payments logged against a period that hasn't started yet still count as paid.
        for (const o of overrides) if (o.payPeriodStart > today) paid += o.amountPaid;
        if (y === year) { earnedNow = earned; paidNow = paid; } else carried += earned - paid;
      }
      const balance = carried + earnedNow - paidNow;
      if (earnedNow > 0 || paidNow > 0 || Math.abs(carried) > 0.5) {
        items.push({
          label: `${e.name} hygiene bonus`,
          detail: `${year}: ${money(earnedNow)} earned, ${money(paidNow)} paid${Math.abs(carried) > 0.5 ? `; ${carried > 0 ? `${money(carried)} carried from earlier years` : `${money(-carried)} paid ahead in earlier years`}` : ""}${balance < 0 ? ` — paid ahead by ${money(-balance)}` : ""}`,
          amount: Math.max(0, balance),
        });
      }
    }
  }

  return { items, total: items.reduce((sum, i) => sum + i.amount, 0) };
}
