export interface CalendarDay {
  date: Date;
  dayNumber: number;
  weekday: string;
}

export function generateMonth(year: number, month: number): CalendarDay[] {
  const days: CalendarDay[] = [];

  const date = new Date(year, month, 1);

  while (date.getMonth() === month) {
    const weekday = date.toLocaleDateString("en-US", {
      weekday: "short",
    });

    // Skip weekends
    if (weekday !== "Sat" && weekday !== "Sun") {
      days.push({
        date: new Date(date),
        dayNumber: date.getDate(),
        weekday,
      });
    }

    date.setDate(date.getDate() + 1);
  }

  return days;
}