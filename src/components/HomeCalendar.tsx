"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { buildDailyAssignments, DailyAssignmentsResult } from "@/lib/assignmentEngine";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SCHEDULE_KEY = "deccan-schedule-v1";

function loadSchedule(): Record<string, { dentists: string[] }> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(SCHEDULE_KEY) ?? "{}"); }
  catch { return {}; }
}

export default function HomeCalendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [schedule, setSchedule] = useState<Record<string, { dentists: string[] }>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => { setStaff(loadStaff()); setSchedule(loadSchedule()); }, []);

  const days = generateMonth(year, month);
  const firstDow = new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstDow });

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); setSelectedDate(null); }
  function nextMonth() { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); setSelectedDate(null); }

  const selectedAssignments: DailyAssignmentsResult | null = useMemo(() => {
    if (!selectedDate) return null;
    const daySched = schedule[selectedDate];
    if (!daySched) return null;
    return buildDailyAssignments(staff, daySched.dentists, selectedDate);
  }, [selectedDate, schedule, staff]);

  const isToday = (date: string) => date === today.toISOString().split("T")[0];

  function getDayStatus(date: string): "complete" | "warning" | "empty" {
    const daySched = schedule[date];
    if (!daySched || daySched.dentists.length === 0) return "empty";
    const a = buildDailyAssignments(staff, daySched.dentists, date);
    if (a.warnings.some(w => w.severity === "error")) return "warning";
    if (a.warnings.length > 0) return "warning";
    return "complete";
  }

  const openDays = days.filter(d => d.isOpen);
  const completeDays = openDays.filter(d => getDayStatus(d.date) === "complete").length;

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif" }}>

      {/* Hero header */}
      <div className="mb-8 rounded-3xl overflow-hidden" style={{ background: "linear-gradient(135deg, #6b6b6b 0%, #7a7a7a 50%, #8a8a8a 100%)", position: "relative" }}>
        <div style={{ position: "absolute", right: -40, top: -40, width: 280, height: 280, borderRadius: "50%", background: "rgba(232,98,42,0.12)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", right: 40, bottom: -60, width: 180, height: 180, borderRadius: "50%", background: "rgba(232,98,42,0.08)", pointerEvents: "none" }} />

        <div className="p-5 relative">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e8622a" }} />
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>Staff Scheduler</span>
              </div>
              <h1 style={{ color: "white", fontSize: 22, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                deccan<span style={{ color: "#e8622a" }}>|</span>dental
              </h1>
              <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, margin: "4px 0 0", letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 400 }}>Sleep Center</p>

              <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 12 }}>
                {formatMonthYear(year, month)} — {completeDays} of {openDays.length} days fully staffed
              </p>

              <div style={{ marginTop: 10, width: 280, height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${openDays.length > 0 ? (completeDays / openDays.length) * 100 : 0}%`, background: "#e8622a", borderRadius: 2, transition: "width 0.5s" }} />
              </div>
            </div>

            <div className="flex flex-col gap-2 items-end">
              <Link href="/schedule-builder" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#e8622a", color: "white", padding: "10px 20px", borderRadius: 12, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                ✏️ Build Schedule
              </Link>
              <Link href="/availability" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)", padding: "10px 20px", borderRadius: 12, fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
                🏥 Mark Absences
              </Link>
            </div>
          </div>

          <div className="flex gap-6 mt-6 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            {[
              { label: "Working Days", value: openDays.length },
              { label: "Fully Staffed", value: completeDays },
              { label: "Needs Attention", value: openDays.filter(d => getDayStatus(d.date) === "warning").length },
              { label: "Not Scheduled", value: openDays.filter(d => getDayStatus(d.date) === "empty").length },
            ].map((stat) => (
              <div key={stat.label}>
                <div style={{ color: "white", fontSize: 18, fontWeight: 700 }}>{stat.value}</div>
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl bg-white shadow-sm" style={{ border: "1px solid #f0f0f0" }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f5f5f5" }}>
              <div className="flex items-center gap-3">
                <button onClick={prevMonth} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50 transition" style={{ borderColor: "#e5e5e5", color: "#5a5a5a" }}>←</button>
                <span style={{ fontWeight: 700, fontSize: 16, color: "#3d3d3d" }}>{formatMonthYear(year, month)}</span>
                <button onClick={nextMonth} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50 transition" style={{ borderColor: "#e5e5e5", color: "#5a5a5a" }}>→</button>
              </div>
              <div className="flex items-center gap-4 text-xs" style={{ color: "#9a9a9a" }}>
                <span className="flex items-center gap-1.5"><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#dcfce7", border: "1px solid #86efac" }} /> Staffed</span>
                <span className="flex items-center gap-1.5"><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#fef3c7", border: "1px solid #fde68a" }} /> Warning</span>
                <span className="flex items-center gap-1.5"><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#f5f5f5", border: "1px solid #e5e5e5" }} /> Not set</span>
              </div>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-7 mb-2">
                {DAY_HEADERS.map((h) => (
                  <div key={h} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: h === "Sun" || h === "Sat" || h === "Tue" ? "#d4d4d4" : "#9a9a9a", paddingBottom: 8 }}>{h}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {blanks.map((_, i) => <div key={`b${i}`} />)}
                {days.map((day) => {
                  const isSelected = selectedDate === day.date;
                  const todayMark = isToday(day.date);
                  const status = day.isOpen ? getDayStatus(day.date) : null;
                  const dentistCount = schedule[day.date]?.dentists?.length ?? 0;

                  if (!day.isOpen) {
                    return (
                      <div key={day.date} style={{ padding: "6px 4px", textAlign: "center", opacity: 0.2, minHeight: 64, display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ fontSize: 10, color: "#9a9a9a" }}>{day.weekday}</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: "#5a5a5a", marginTop: 2 }}>{day.day}</div>
                      </div>
                    );
                  }

                  const bgColor = isSelected ? "#e8622a" : status === "complete" ? "#f0fdf4" : status === "warning" ? "#fffbeb" : "#fafafa";
                  const borderColor = isSelected ? "#e8622a" : status === "complete" ? "#bbf7d0" : status === "warning" ? "#fde68a" : "#e5e5e5";

                  return (
                    <button key={day.date} onClick={() => setSelectedDate(isSelected ? null : day.date)}
                      style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10, padding: "6px 4px", minHeight: 64, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", transition: "all 0.15s", outline: todayMark && !isSelected ? `2px solid #e8622a` : "none", outlineOffset: 1, width: "100%" }}>
                      <div style={{ fontSize: 10, color: isSelected ? "rgba(255,255,255,0.7)" : "#9a9a9a" }}>{day.weekday}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: isSelected ? "white" : todayMark ? "#e8622a" : "#3d3d3d", marginTop: 2 }}>{day.day}</div>
                      {dentistCount > 0 && <div style={{ fontSize: 10, color: isSelected ? "rgba(255,255,255,0.8)" : "#9a9a9a", marginTop: 3 }}>{dentistCount} dr{dentistCount !== 1 ? "s" : ""}</div>}
                      {status === "complete" && !isSelected && <div style={{ fontSize: 9, color: "#16a34a", marginTop: 2 }}>✓</div>}
                      {status === "warning" && !isSelected && <div style={{ fontSize: 9, color: "#d97706", marginTop: 2 }}>⚠</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div>
          {selectedDate && selectedAssignments ? (
            <div className="rounded-2xl bg-white shadow-sm overflow-hidden" style={{ border: "1px solid #f0f0f0" }}>
              <div className="px-5 py-4" style={{ borderBottom: "1px solid #f5f5f5", background: "#fafafa" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#3d3d3d" }}>{selectedDate ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : ""}</div>
                {selectedAssignments.warnings.length === 0 && <div style={{ fontSize: 11, color: "#16a34a", marginTop: 3 }}>✓ Fully staffed</div>}
              </div>

              {selectedAssignments.warnings.length > 0 && (
                <div className="px-5 py-3" style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a" }}>
                  {selectedAssignments.warnings.map((w, i) => (
                    <p key={i} style={{ margin: 0, fontSize: 11, color: w.severity === "error" ? "#dc2626" : "#d97706" }}>{w.severity === "error" ? "🔴" : "⚠️"} {w.message}</p>
                  ))}
                </div>
              )}

              <div className="p-5 space-y-5">
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9a9a9a", marginBottom: 8 }}>Dentist · Assistant</div>
                  {selectedAssignments.dentists.length === 0 ? <p style={{ fontSize: 12, color: "#d4d4d4" }}>No dentists selected</p> : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {selectedAssignments.dentists.map(({ dentist, assistant }) => (
                        <div key={dentist.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafafa", borderRadius: 8, padding: "8px 10px", border: "1px solid #f0f0f0" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#3d3d3d" }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: dentist.color, flexShrink: 0, display: "inline-block" }} />{dentist.name}
                          </span>
                          <span style={{ fontSize: 11, color: assistant ? "#5a5a5a" : "#f59e0b", display: "flex", alignItems: "center", gap: 4 }}>
                            {assistant ? <><span style={{ width: 6, height: 6, borderRadius: "50%", background: assistant.color, display: "inline-block" }} />{assistant.name}</> : "No assistant"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9a9a9a", marginBottom: 8 }}>Front Desk</div>
                  {selectedAssignments.frontDesk.length === 0 ? <p style={{ fontSize: 12, color: "#d4d4d4" }}>None available</p> :
                    selectedAssignments.frontDesk.map((e) => (
                      <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5a5a5a", marginBottom: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: e.color, display: "inline-block" }} />{e.name}
                      </div>
                    ))}
                </div>

                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9a9a9a", marginBottom: 8 }}>Hygienist/Assisted Hygiene</div>
                  {selectedAssignments.hygienists.length === 0 ? <p style={{ fontSize: 12, color: "#d4d4d4" }}>None available</p> :
                    selectedAssignments.hygienists.map((e) => (
                      <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5a5a5a", marginBottom: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: e.color, display: "inline-block" }} />{e.name}
                      </div>
                    ))}
                </div>

                <Link href="/schedule-builder?step=3" style={{ display: "block", textAlign: "center", background: "#fff0eb", color: "#e8622a", padding: "10px", borderRadius: 10, fontSize: 12, fontWeight: 600, textDecoration: "none", border: "1px solid #fcd9c8" }}>
                  ✏️ Edit this day
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white shadow-sm flex flex-col items-center justify-center text-center" style={{ border: "1px solid #f0f0f0", minHeight: 320, padding: 32 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: "#fff0eb", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 28 }}>📅</span>
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#5a5a5a", margin: 0 }}>Select a day</p>
              <p style={{ fontSize: 12, color: "#9a9a9a", marginTop: 6, maxWidth: 180 }}>Click any working day to view staffing details</p>

              <div style={{ marginTop: 24, width: "100%", borderTop: "1px solid #f5f5f5", paddingTop: 20 }}>
                <p style={{ fontSize: 11, color: "#9a9a9a", marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Quick Actions</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Link href="/schedule-builder" style={{ display: "flex", alignItems: "center", gap: 8, background: "#e8622a", color: "white", padding: "10px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
                    <span>✏️</span> Build this month's schedule
                  </Link>
                  <Link href="/leave" style={{ display: "flex", alignItems: "center", gap: 8, background: "#fafafa", color: "#5a5a5a", padding: "10px 14px", borderRadius: 10, fontSize: 12, fontWeight: 500, textDecoration: "none", border: "1px solid #f0f0f0" }}>
                    <span>📝</span> Submit a leave request
                  </Link>
                  <Link href="/availability" style={{ display: "flex", alignItems: "center", gap: 8, background: "#fafafa", color: "#5a5a5a", padding: "10px 14px", borderRadius: 10, fontSize: 12, fontWeight: 500, textDecoration: "none", border: "1px solid #f0f0f0" }}>
                    <span>🏥</span> Mark staff absences
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
