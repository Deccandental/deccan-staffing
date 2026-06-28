export interface CalendarDay {
  date: string;
  day: number;
  weekday: string;
}

export function generateMonth(
  year: number,
  month: number
): CalendarDay[] {

  const days: CalendarDay[] = [];

  const current = new Date(year, month, 1);

  while (current.getMonth() === month) {

    const weekday = current.toLocaleDateString("en-US", {
      weekday: "short",
    });

    if (weekday !== "Sat" && weekday !== "Sun") {

      days.push({
        date: current.toISOString(),
        day: current.getDate(),
        weekday,
      });

    }

    current.setDate(current.getDate() + 1);
  }

  return days;
}