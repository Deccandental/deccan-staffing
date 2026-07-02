"use client";

import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { OpenTuesday } from "@/lib/openTuesdays";
import { Holiday } from "@/lib/holidays";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface DayAssignmentSummary {
  dentists: { id: number; name: string; color: string; assistantName: string | null }[];
  frontDesk: string[];
  hygienists: string[];
  floater?: string | null;
}

interface Props {
  year: number;
  month: number;
  dayStatuses: Record<string, "complete" | "warning" | "empty">;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  openTuesdays?: OpenTuesday[];
  holidays?: Holiday[];
  dayAssignments?: Record<string, DayAssignmentSummary>;
}

export default function MonthlyOverview({ year, month, dayStatuses, selectedDate, onSelectDate, openTuesdays = [], holidays = [], dayAssignments }: Props) {
  const days = generateMonth(year, month, openTuesdays, holidays);
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
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-red-200" /> Holiday</span>
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
          const info = dayAssignments?.[day.date];

          if (!day.isOpen) {
            return (
              <div key={day.date} className="rounded-lg p-2 text-center select-none min-h-[60px]"
                style={{ opacity: day.isHoliday ? 1 : 0.25 }}>
                <div className={`text-xs ${day.isHoliday ? "text-red-400" : "text-slate-400"}`}>{day.weekday}</div>
                <div className={`text-sm font-medium ${day.isHoliday ? "text-red-500" : "text-slate-400"}`}>{day.day}</div>
                {day.isHoliday && <div className="text-xs text-red-400 truncate" style={{ fontSize: 8 }}>{day.holidayName?.slice(0, 8)}</div>}
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
              className={`rounded-lg border p-1.5 text-left transition flex flex-col min-h-[60px] ${info ? "min-h-[92px]" : ""} ${statusStyle}`}>
              <div className="flex items-center justify-between gap-1">
                <span className={`text-xs ${isSelected ? "text-cyan-100" : isOpenTue ? "text-blue-400" : "text-slate-400"}`}>{day.weekday}</span>
                <span className="text-sm font-semibold">{day.day}</span>
              </div>
              {!isSelected && status === "complete" && !info && <div className="mt-0.5 text-xs text-green-500 text-center">✓</div>}
              {!isSelected && status === "warning" && !info && <div className="mt-0.5 text-xs text-amber-500 text-center">⚠</div>}
              {isOpenTue && !status && !info && <div className="mt-0.5 text-xs text-blue-400 text-center">Open</div>}

              {info && (
                <div className="mt-1 space-y-0.5 overflow-hidden">
                  {info.dentists.map((d) => (
                    <div key={d.id} className="truncate text-[9px] leading-tight"
                      title={`${d.name} / ${d.assistantName ?? "No Assistant"}`}>
                      <span className="font-semibold" style={!isSelected ? { color: d.color } : undefined}>
                        {d.name}
                      </span>
                      <span className={isSelected ? "text-cyan-100" : "text-slate-400"}>
                        /{d.assistantName ?? "—"}
                      </span>
                    </div>
                  ))}
                  {info.frontDesk.length > 0 && (
                    <div className="truncate text-[9px] leading-tight">
                      <span className={`font-semibold ${isSelected ? "text-cyan-100" : "text-sky-600"}`}>Front:</span>{" "}
                      <span className={isSelected ? "text-cyan-50" : "text-slate-500"}>{info.frontDesk.join("/")}</span>
                    </div>
                  )}
                  {info.hygienists.length > 0 && (
                    <div className="truncate text-[9px] leading-tight">
                      <span className={`font-semibold ${isSelected ? "text-cyan-100" : "text-emerald-600"}`}>Hyg:</span>{" "}
                      <span className={isSelected ? "text-cyan-50" : "text-slate-500"}>{info.hygienists.join("/")}</span>
                    </div>
                  )}
                  {info.floater && (
                    <div className="truncate text-[9px] leading-tight">
                      <span className={`font-semibold ${isSelected ? "text-cyan-100" : "text-slate-500"}`}>Float:</span>{" "}
                      <span className={isSelected ? "text-cyan-50" : "text-slate-500"}>{info.floater}</span>
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
