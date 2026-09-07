"use client";

import { useState } from "react";
import { generateMonth, formatMonthYear } from "@/utils/calendar";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

export default function MonthlyPlanner({ selectedDate, onSelectDate }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const days = generateMonth(year, month);

  // Day-of-week offset for the 1st of the month (0=Sun)
  const firstDow = new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstDow });

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Monthly Planner</h2>
          <p className="mt-1 text-sm text-slate-500">
            Select an open day to manage staffing. Tuesdays and weekends are closed.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 transition"
          >
            ←
          </button>
          <span className="min-w-[140px] text-center font-semibold">
            {formatMonthYear(year, month)}
          </span>
          <button
            onClick={nextMonth}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 transition"
          >
            →
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-2">
        {DAY_HEADERS.map((h) => (
          <div
            key={h}
            className={`py-2 text-center text-xs font-semibold uppercase tracking-wide ${
              h === "Sun" || h === "Sat" || h === "Tue"
                ? "text-slate-300"
                : "text-slate-500"
            }`}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {blanks.map((_, i) => (
          <div key={`blank-${i}`} />
        ))}

        {days.map((day) => {
          const isSelected = selectedDate === day.date;
          const closed = !day.isOpen;

          if (closed) {
            return (
              <div
                key={day.date}
                className="rounded-lg p-2 text-center opacity-30 cursor-not-allowed select-none"
              >
                <div className="text-xs text-slate-400">{day.weekday}</div>
                <div className="mt-1 text-sm font-medium text-slate-400">{day.day}</div>
              </div>
            );
          }

          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelectDate(day.date)}
              className={`rounded-lg border p-2 text-center transition ${
                isSelected
                  ? "border-cyan-600 bg-cyan-600 text-white"
                  : "border-slate-200 hover:border-cyan-400 hover:bg-cyan-50"
              }`}
            >
              <div className={`text-xs ${isSelected ? "text-cyan-100" : "text-slate-400"}`}>
                {day.weekday}
              </div>
              <div className="mt-1 text-sm font-semibold">{day.day}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
