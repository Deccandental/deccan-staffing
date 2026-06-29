export interface CalendarDay {
  date: string;
  day: number;
  weekday: string;
  isOpen: boolean;
  isWeekend: boolean;
  isHoliday?: boolean;
  holidayName?: string;
}

const CLOSED_WEEKDAYS = new Set([0, 6]); // Sun=0, Sat=6 — Tuesdays now flexible

export function generateMonth(year: number, month: number): CalendarDay[] {
  let holidayMap: Record<string, string> = {};
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("deccan-holidays-v1");
      if (raw) {
        const holidays = JSON.parse(raw) as { date: string; name: string }[];
        holidays.forEach((h) => { holidayMap[h.date] = h.name; });
      }
    } catch {}
  }

  const days: CalendarDay[] = [];
  const totalDays = new Date(year, month, 0).getDate();

  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month - 1, day);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const dateStr = date.toISOString().split("T")[0];
    const holidayName = holidayMap[dateStr];
    const isHoliday = !!holidayName;
    const isOpen = !CLOSED_WEEKDAYS.has(dow) && !isHoliday;

    days.push({
      date: dateStr,
      day,
      weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
      isOpen,
      isWeekend,
      isHoliday,
      holidayName,
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
