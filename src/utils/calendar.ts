export interface CalendarDay {
  date: string;
  day: number;
  weekday: string;
  isOpen: boolean;      // false for weekends + Tuesdays
  isWeekend: boolean;
}

const CLOSED_WEEKDAYS = new Set([0, 2, 6]); // Sun=0, Tue=2, Sat=6

export function generateMonth(year: number, month: number): CalendarDay[] {
  const days: CalendarDay[] = [];
  const totalDays = new Date(year, month, 0).getDate();

  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month - 1, day);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isOpen = !CLOSED_WEEKDAYS.has(dow);

    days.push({
      date: date.toISOString().split("T")[0],
      day,
      weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
      isOpen,
      isWeekend,
    });
  }

  return days;
}

export function formatMonthYear(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
