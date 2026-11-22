// Today's date as YYYY-MM-DD in the practice's own time zone (California).
//
// `new Date().toISOString().slice(0, 10)` gives the date in UTC, which is
// already tomorrow after about 4–5pm Pacific — so evening payments were dated
// the next day, today's events dropped off lists, and quarters ended early.
// This works the same in the browser and on the server (which runs in UTC).
export const PRACTICE_TIME_ZONE = "America/Los_Angeles";

export function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PRACTICE_TIME_ZONE }).format(new Date());
}
