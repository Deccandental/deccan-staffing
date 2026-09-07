// Pay periods run 1st–15th and 16th–end of month. Given a reference date,
// returns the pay period that just ended ("last") and the one that's
// starting now ("next") — e.g. on the 1st, "last" is the 16th–end of the
// PREVIOUS month and "next" is the 1st–15th of the current month; on the
// 16th, "last" is the 1st–15th of the current month and "next" is the
// 16th–end of the current month.

export interface PayPeriod {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string; // e.g. "December 16–31"
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(y: number, m: number): number {
  // Date(y, m, 0) with a 1-indexed m gives the last day of month m.
  return new Date(y, m, 0).getDate();
}

export function getPayPeriods(refDate: Date): { last: PayPeriod; next: PayPeriod } {
  const y = refDate.getUTCFullYear();
  const m = refDate.getUTCMonth() + 1; // 1-indexed
  const day = refDate.getUTCDate();

  if (day <= 15) {
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevYear = m === 1 ? y - 1 : y;
    const prevLastDay = daysInMonth(prevYear, prevMonth);
    return {
      last: {
        start: ymd(prevYear, prevMonth, 16),
        end: ymd(prevYear, prevMonth, prevLastDay),
        label: `${MONTH_NAMES[prevMonth - 1]} 16–${prevLastDay}`,
      },
      next: {
        start: ymd(y, m, 1),
        end: ymd(y, m, 15),
        label: `${MONTH_NAMES[m - 1]} 1–15`,
      },
    };
  }

  const lastDay = daysInMonth(y, m);
  return {
    last: {
      start: ymd(y, m, 1),
      end: ymd(y, m, 15),
      label: `${MONTH_NAMES[m - 1]} 1–15`,
    },
    next: {
      start: ymd(y, m, 16),
      end: ymd(y, m, lastDay),
      label: `${MONTH_NAMES[m - 1]} 16–${lastDay}`,
    },
  };
}

/** The ~3-month forward-looking window that follows the "next" pay period. */
export function getLookaheadWindow(nextPeriodEnd: string): { start: string; end: string; label: string } {
  const [y, m, d] = nextPeriodEnd.split("-").map(Number);
  const startDate = new Date(Date.UTC(y, m - 1, d + 1));
  const endDate = new Date(Date.UTC(y, m - 1, d));
  endDate.setUTCMonth(endDate.getUTCMonth() + 3);
  const start = ymd(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, startDate.getUTCDate());
  const end = ymd(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate());
  return { start, end, label: "Next 3 Months" };
}
