"use client";

import { useState, useEffect, useMemo } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate from "@/components/AppIdentityGate";
import { StaffEvent, loadEventsForMonth } from "@/lib/eventsStore";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function EventsCalendarBody() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-indexed
  const [events, setEvents] = useState<StaffEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const today = todayStr();

  useEffect(() => {
    setLoading(true);
    loadEventsForMonth(year, month).then((ev) => { setEvents(ev); setLoading(false); });
  }, [year, month]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, StaffEvent[]> = {};
    for (const ev of events) {
      (map[ev.date] ??= []).push(ev);
    }
    for (const list of Object.values(map)) list.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    return map;
  }, [events]);

  const firstOfMonth = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = firstOfMonth.getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    return { day: d, date: `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  });

  function goPrevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); } else { setMonth((m) => m - 1); }
  }
  function goNextMonth() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); } else { setMonth((m) => m + 1); }
  }

  const selectedEvents = selectedDate ? eventsByDate[selectedDate] ?? [] : [];

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">Events Calendar</h1>
          <p className="text-sm text-slate-500 mt-1">Events only — no staff shifts. For the full schedule, see the Calendar page.</p>
        </header>

        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-4">
            <button onClick={goPrevMonth} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 transition">← Prev</button>
            <h2 className="text-lg font-bold text-slate-700">{MONTH_NAMES[month - 1]} {year}</h2>
            <button onClick={goNextMonth} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 transition">Next →</button>
          </div>

          {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
            <div className="rounded-2xl bg-white p-4 lg:p-6 shadow">
              <div className="grid grid-cols-7 mb-2">
                {DAY_HEADERS.map((h) => (
                  <div key={h} className="py-1 text-center text-xs font-bold uppercase tracking-wide text-slate-500">{h}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: startWeekday }, (_, i) => <div key={`b${i}`} />)}
                {days.map(({ day, date }) => {
                  const dayEvents = eventsByDate[date] ?? [];
                  const isToday = date === today;
                  const isSelected = selectedDate === date;
                  return (
                    <button key={date} onClick={() => setSelectedDate(date)}
                      className="aspect-square rounded-lg p-1 text-left flex flex-col overflow-hidden transition"
                      style={{
                        background: isSelected ? "#fff7ed" : isToday ? "#fef3c7" : "white",
                        border: isSelected ? "2px solid #e8622a" : "1px solid #e2e8f0",
                      }}>
                      <span className={`text-xs font-semibold ${isToday ? "text-amber-700" : "text-slate-600"}`}>{day}</span>
                      <div className="flex-1 overflow-hidden space-y-0.5 mt-0.5">
                        {dayEvents.slice(0, 2).map((ev) => (
                          <div key={ev.id} className="text-[9px] leading-tight rounded px-1 truncate" style={{ background: ev.mandatory ? "#fee2e2" : "#dbeafe", color: ev.mandatory ? "#991b1b" : "#1e3a8a" }}>
                            {ev.title}
                          </div>
                        ))}
                        {dayEvents.length > 2 && <div className="text-[9px] text-slate-400">+{dayEvents.length - 2} more</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedDate && (
            <div className="mt-4 rounded-2xl bg-white p-5 shadow">
              <h3 className="font-bold text-slate-700 mb-3">
                {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </h3>
              {selectedEvents.length === 0 ? (
                <p className="text-sm text-slate-400">No events this day.</p>
              ) : (
                <div className="space-y-2">
                  {selectedEvents.map((ev) => (
                    <div key={ev.id} className="rounded-lg p-3" style={{ background: ev.mandatory ? "#fee2e2" : "#eff6ff" }}>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <p className="font-semibold text-sm" style={{ color: ev.mandatory ? "#991b1b" : "#1e3a8a" }}>
                          {ev.mandatory ? "🔴 " : ""}{ev.title}
                        </p>
                        <span className="text-xs text-slate-500">{ev.time ? `${ev.time}${ev.endTime ? `–${ev.endTime}` : ""}` : "All Day"}</span>
                      </div>
                      {ev.description && <p className="text-sm text-slate-600 mt-1">{ev.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function EventsCalendarPage() {
  return (
    <AppIdentityGate>
      {() => <EventsCalendarBody />}
    </AppIdentityGate>
  );
}
