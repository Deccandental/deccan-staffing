"use client";

import { useState, useEffect } from "react";
import { DailyAssignmentsResult } from "@/lib/assignmentEngine";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";

interface Props {
  selectedDate: string;
  assignments?: DailyAssignmentsResult;
  assistantOverrides?: Record<number, number | null>;
  onOverrideChange?: (overrides: Record<number, number | null>) => void;
}

const EMPTY: DailyAssignmentsResult = { dentists: [], frontDesk: [], hygienists: [], warnings: [] };

export default function DailyAssignmentPanel({ selectedDate, assignments = EMPTY, assistantOverrides = {}, onOverrideChange }: Props) {
  const [overrides, setOverrides] = useState<Record<number, number | null>>(assistantOverrides);
  const [swapping, setSwapping] = useState<number | null>(null);
  const [staff, setStaff] = useState<Employee[]>([]);

  useEffect(() => {
    loadStaff().then(setStaff);
  }, []);

  // Sync overrides when prop changes (e.g. switching days)
  useEffect(() => {
    setOverrides(assistantOverrides);
    setSwapping(null);
  }, [selectedDate, JSON.stringify(assistantOverrides)]);

  const availableAssistants = staff.filter((e) => e.skills.includes("Assistant"));

  const dateLabel = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric",
      })
    : "";

  function getAssistant(dentistId: number, defaultAssistant: Employee | null): Employee | null {
    if (dentistId in overrides) {
      const ovId = overrides[dentistId];
      return ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
    }
    return defaultAssistant;
  }

  function handleOverride(dentistId: number, value: string) {
    const newOverrides = { ...overrides, [dentistId]: value ? Number(value) : null };
    setOverrides(newOverrides);
    setSwapping(null);
    onOverrideChange?.(newOverrides);
  }

  function handleClearOverride(dentistId: number) {
    const newOverrides = { ...overrides };
    delete newOverrides[dentistId];
    setOverrides(newOverrides);
    onOverrideChange?.(newOverrides);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="mb-5">
        <h2 className="text-2xl font-bold">Daily Assignments</h2>
        <p className="mt-1 text-slate-500">{dateLabel || "Select a day"}</p>
      </div>

      {assignments.warnings.length > 0 && (
        <div className="mb-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4">
          {assignments.warnings.map((w, i) => (
            <p key={i} className={`text-sm ${w.severity === "error" ? "text-red-600" : "text-amber-700"}`}>
              {w.severity === "error" ? "🔴" : "⚠️"} {w.message}
            </p>
          ))}
        </div>
      )}

      <section className="mb-4 rounded-xl border p-4">
        <h3 className="mb-3 font-semibold text-slate-700">Dentist / Assistant Pairings</h3>
        {assignments.dentists.length === 0 ? (
          <p className="text-sm text-slate-400">No dentists selected.</p>
        ) : (
          <div className="space-y-2">
            {assignments.dentists.map(({ dentist, assistant }) => {
              const resolvedAssistant = getAssistant(dentist.id, assistant);
              const isOverridden = dentist.id in overrides;
              return (
                <div key={dentist.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium text-sm">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dentist.color }} />
                      {dentist.name}
                    </span>
                    <div className="flex items-center gap-2">
                      {swapping === dentist.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            className="rounded border border-slate-200 px-2 py-1 text-xs"
                            defaultValue={resolvedAssistant?.id ?? ""}
                            onChange={(e) => handleOverride(dentist.id, e.target.value)}
                          >
                            <option value="">No Assistant</option>
                            {availableAssistants.map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                          <button onClick={() => setSwapping(null)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
                        </div>
                      ) : (
                        <>
                          <span className={`text-sm flex items-center gap-1.5 ${resolvedAssistant ? "text-slate-600" : "text-amber-500"}`}>
                            {resolvedAssistant ? (
                              <>
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: resolvedAssistant.color }} />
                                {resolvedAssistant.name}
                                {isOverridden && (
                                  <button onClick={() => handleClearOverride(dentist.id)} className="text-xs text-cyan-500 ml-1 hover:text-red-400" title="Clear manual override">
                                    (manual ✕)
                                  </button>
                                )}
                              </>
                            ) : "No Assistant"}
                          </span>
                          <button
                            onClick={() => setSwapping(dentist.id)}
                            className="rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-200 hover:text-slate-600 transition"
                            title="Override assignment"
                          >
                            swap
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border p-4">
        <h3 className="mb-3 font-semibold text-slate-700">Front Desk</h3>
        {assignments.frontDesk.length === 0 ? (
          <p className="text-sm text-slate-400">None available</p>
        ) : (
          <div className="space-y-1">
            {assignments.frontDesk.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                {e.name}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border p-4">
        <h3 className="mb-3 font-semibold text-slate-700">Hygienist/Assisted Hygiene</h3>
        {assignments.hygienists.length === 0 ? (
          <p className="text-sm text-slate-400">None available</p>
        ) : (
          <div className="space-y-1">
            {assignments.hygienists.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                {e.name}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
