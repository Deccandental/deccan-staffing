"use client";

import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { OpenTuesday } from "@/lib/openTuesdays";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  year: number;
  month: number;
  dayStatuses: Record<string, "complete" | "warning" | "empty">;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  openTuesdays?: OpenTuesday[];
}

export default function MonthlyOverview({ year, month, dayStatuses, selectedDate, onSelectDate, openTuesdays = [] }: Props) {
  const days = generateMonth(year, month, openTuesdays);
  const firstDow = new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstDow });

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-bold">{formatMonthYear(year, month)}</h3>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-green-400" /> Ready</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-400" /> Warning</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-slate-200" /> Not set</span>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-2">
        {DAY_HEADERS.map((h) => (
          <div key={h} className={`py-1 text-center text-xs font-semibold uppercase tracking-wide ${
            h === "Sun" || h === "Sat" ? "text-slate-300" : h === "Tue" ? "text-blue-300" : "text-slate-400"
          }`}>
            {h}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {blanks.map((_, i) => <div key={`b${i}`} />)}
        {days.map((day) => {
          const isSelected = selectedDate === day.date;
          const status = dayStatuses[day.date];
          const isOpenTue = day.isTuesday && day.isOpenTuesday;

          if (!day.isOpen) {
            return (
              <div key={day.date} className="rounded-lg p-2 text-center select-none"
                style={{ opacity: 0.25 }}>
                <div className="text-xs text-slate-400">{day.weekday}</div>
                <div className="text-sm font-medium text-slate-400">{day.day}</div>
              </div>
            );
          }

          const statusStyle =
            isSelected ? "border-cyan-500 bg-cyan-500 text-white shadow-md"
            : isOpenTue && !status ? "border-blue-300 bg-blue-50 hover:bg-blue-100"
            : status === "complete" ? "border-green-300 bg-green-50 hover:bg-green-100"
            : status === "warning" ? "border-amber-300 bg-amber-50 hover:bg-amber-100"
            : "border-slate-200 bg-white hover:bg-slate-50";

          return (
            <button key={day.date} onClick={() => onSelectDate(day.date)}
              className={`rounded-lg border p-2 text-center transition ${statusStyle}`}>
              <div className={`text-xs ${isSelected ? "text-cyan-100" : isOpenTue ? "text-blue-400" : "text-slate-400"}`}>{day.weekday}</div>
              <div className="text-sm font-semibold mt-0.5">{day.day}</div>
              {isOpenTue && !isSelected && !status && <div className="mt-0.5 text-xs text-blue-400">Open</div>}
              {!isSelected && status === "complete" && <div className="mt-0.5 text-xs text-green-500">✓</div>}
              {!isSelected && status === "warning" && <div className="mt-0.5 text-xs text-amber-500">⚠</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
