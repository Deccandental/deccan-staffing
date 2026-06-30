"use client";

import { useState, useEffect } from "react";
import { DailyAssignmentsResult } from "@/lib/assignmentEngine";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import { TempStaff } from "@/app/temps/page";
import { TempAssignment, getTempAssignments, addTempAssignment, removeTempAssignment } from "@/lib/tempAssignments";
import { supabase } from "@/lib/supabase";

interface Props {
  selectedDate: string;
  assignments?: DailyAssignmentsResult;
  assistantOverrides?: Record<number, number | null>;
  onOverrideChange?: (overrides: Record<number, number | null>) => void;
  onTempAssignmentsChange?: (date: string, assignments: TempAssignment[]) => void;
}

const EMPTY: DailyAssignmentsResult = { dentists: [], frontDesk: [], hygienists: [], warnings: [] };

const ROLE_COLORS: Record<string, string> = {
  Dentist: "#2563eb", RDA: "#dc2626", Assistant: "#db2777",
  "Front Desk": "#0284c7", Hygienist: "#059669", Other: "#6b7280",
};

async function loadTemps(): Promise<TempStaff[]> {
  const { data, error } = await supabase.from("temps").select("*").order("rating", { ascending: false });
  if (error) { console.error("loadTemps error:", error); return []; }
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, phone: row.phone ?? "", email: row.email ?? "",
    role: row.role, skills: row.skills ?? [], rating: row.rating ?? 0,
    notes: row.notes ?? "", addedAt: row.added_at,
  }));
}

export default function DailyAssignmentPanel({ selectedDate, assignments = EMPTY, assistantOverrides = {}, onOverrideChange, onTempAssignmentsChange }: Props) {
  const [overrides, setOverrides] = useState<Record<number, number | null>>(assistantOverrides);
  const [swapping, setSwapping] = useState<number | null>(null);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [temps, setTemps] = useState<TempStaff[]>([]);
  const [tempAssignments, setTempAssignments] = useState<TempAssignment[]>([]);
  const [assigningRole, setAssigningRole] = useState<string | null>(null);
  const [selectedTempId, setSelectedTempId] = useState("");
  const [selectedDentistId, setSelectedDentistId] = useState<number | null>(null);

  useEffect(() => {
    loadStaff().then(setStaff);
    loadTemps().then(setTemps);
  }, []);

  useEffect(() => {
    setOverrides(assistantOverrides);
    setSwapping(null);
    setAssigningRole(null);
    setSelectedTempId("");
    setSelectedDentistId(null);
    if (selectedDate) {
      getTempAssignments(selectedDate).then(setTempAssignments);
    }
  }, [selectedDate, JSON.stringify(assistantOverrides)]);

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

  // Assistants currently in use elsewhere today: as another dentist's assistant,
  // or as a hygienist. A dual-role staffer (skills include both "Assistant" and
  // "Hygienist") must not show up as available once they're already booked.
  function getAvailableAssistantsFor(dentistId: number): Employee[] {
    const takenIds = new Set<number>();

    assignments.dentists.forEach(({ dentist, assistant }) => {
      if (dentist.id === dentistId) return; // exclude the dentist we're swapping for
      const resolved = getAssistant(dentist.id, assistant);
      if (resolved) takenIds.add(resolved.id);
    });

    assignments.hygienists.forEach((h) => takenIds.add(h.id));

    return staff.filter((e) => e.skills.includes("Assistant") && !takenIds.has(e.id));
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

  async function handleAssignTemp() {
    if (!selectedTempId || !assigningRole) return;
    if (assigningRole === "Assistant" && !selectedDentistId) return;
    const notes = assigningRole === "Assistant" && selectedDentistId
      ? `dentist:${selectedDentistId}`
      : "";
    await addTempAssignment({ date: selectedDate, tempId: selectedTempId, role: assigningRole, notes });
    const updated = await getTempAssignments(selectedDate);
    setTempAssignments(updated);
    onTempAssignmentsChange?.(selectedDate, updated);
    setAssigningRole(null);
    setSelectedTempId("");
    setSelectedDentistId(null);
  }

  async function handleRemoveTemp(id: string) {
    await removeTempAssignment(id);
    const updated = await getTempAssignments(selectedDate);
    setTempAssignments(updated);
    onTempAssignmentsChange?.(selectedDate, updated);
  }

  function getTempsForRole(role: string): TempStaff[] {
    return temps.filter((t) => t.role === role || t.skills.includes(role));
  }

  const workingDentists = assignments.dentists.map((d) => d.dentist);

  function getTempDentistName(notes: string): string {
    if (!notes.startsWith("dentist:")) return "";
    const dentistId = Number(notes.replace("dentist:", ""));
    return staff.find((e) => e.id === dentistId)?.name ?? "";
  }

  const tempsByRole: Record<string, { assignment: TempAssignment; temp: TempStaff | undefined }[]> = {};
  for (const ta of tempAssignments) {
    if (!tempsByRole[ta.role]) tempsByRole[ta.role] = [];
    tempsByRole[ta.role].push({ assignment: ta, temp: temps.find((t) => t.id === ta.tempId) });
  }

  // Determine which dentists still need an assistant (no override, no temp)
  const dentistsStillNeedingAssistant = assignments.dentists.filter((d) => {
    const hasOverride = d.dentist.id in overrides;
    const hasTemp = tempAssignments.some((ta) => ta.role === "Assistant" && ta.notes === `dentist:${d.dentist.id}`);
    return !d.assistant && !hasOverride && !hasTemp;
  });

  const hygienistStillNeeded = assignments.hygienists.length === 0 && (tempsByRole["Hygienist"]?.length ?? 0) === 0 && assignments.dentists.length > 0;
  const frontDeskStillShort = assignments.warnings.some((w) => w.message.includes("front desk")) && (tempsByRole["Front Desk"]?.length ?? 0) === 0;

  // Filter warnings to hide ones already resolved by temps
  const visibleWarnings = assignments.warnings.filter((w) => {
    if (w.message.includes("hygienist")) return hygienistStillNeeded;
    if (w.message.includes("front desk")) return frontDeskStillShort;
    if (w.message.includes("assistant")) {
      // Check if this is a dentist-specific warning
      const dentistMatch = assignments.dentists.find((d) => w.message.includes(d.dentist.name));
      if (dentistMatch) {
        const hasTemp = tempAssignments.some((ta) => ta.role === "Assistant" && ta.notes === `dentist:${dentistMatch.dentist.id}`);
        const hasOverride = dentistMatch.dentist.id in overrides;
        return !hasTemp && !hasOverride;
      }
      // General assistant shortage warning
      return dentistsStillNeedingAssistant.length > 0;
    }
    return true;
  });

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="mb-5">
        <h2 className="text-2xl font-bold">Daily Assignments</h2>
        <p className="mt-1 text-slate-500">{dateLabel || "Select a day"}</p>
      </div>

      {visibleWarnings.length > 0 && (
        <div className="mb-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
          {visibleWarnings.map((w, i) => {
            let tempRole: string | null = null;
            if (w.message.includes("assistant")) tempRole = "Assistant";
            else if (w.message.includes("front desk")) tempRole = "Front Desk";
            else if (w.message.includes("hygienist")) tempRole = "Hygienist";

            return (
              <div key={i} className="flex items-center justify-between gap-2">
                <p className={`text-sm ${w.severity === "error" ? "text-red-600" : "text-amber-700"}`}>
                  {w.severity === "error" ? "🔴" : "⚠️"} {w.message}
                </p>
                {tempRole && (
                  <button onClick={() => { setAssigningRole(tempRole); setSelectedTempId(""); setSelectedDentistId(null); }}
                    className="flex-shrink-0 rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90 transition"
                    style={{ backgroundColor: ROLE_COLORS[tempRole] ?? "#6b7280" }}>
                    + Assign Temp
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {assigningRole && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-blue-700">Assign Temp {assigningRole}</p>
            <button onClick={() => { setAssigningRole(null); setSelectedTempId(""); setSelectedDentistId(null); }}
              className="text-xs text-blue-400 hover:text-blue-600">✕ Cancel</button>
          </div>

          {assigningRole === "Assistant" && workingDentists.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-blue-600 mb-2">Which dentist are they assisting?</p>
              <div className="grid gap-1.5">
                {workingDentists.map((dentist) => {
                  const alreadyHasTemp = tempAssignments.some((ta) => ta.role === "Assistant" && ta.notes === `dentist:${dentist.id}`);
                  return (
                    <button key={dentist.id}
                      disabled={alreadyHasTemp}
                      onClick={() => setSelectedDentistId(dentist.id)}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition disabled:opacity-40 disabled:cursor-not-allowed"
                      style={selectedDentistId === dentist.id
                        ? { borderColor: dentist.color, backgroundColor: "#f0f9ff" }
                        : { borderColor: "#e5e7eb", background: "white" }}>
                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dentist.color }} />
                      <span className="text-sm font-medium text-slate-700">{dentist.name}</span>
                      {alreadyHasTemp && <span className="ml-auto text-xs text-slate-400">Already has temp</span>}
                      {selectedDentistId === dentist.id && (
                        <span className="ml-auto text-xs font-bold" style={{ color: dentist.color }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {getTempsForRole(assigningRole).length === 0 ? (
            <p className="text-sm text-blue-400">No temps available for this role. <a href="/temps" className="underline">Add to roster →</a></p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-blue-600 mb-2">Select a temp:</p>
              <div className="grid gap-2">
                {getTempsForRole(assigningRole).map((temp) => (
                  <button key={temp.id} onClick={() => setSelectedTempId(temp.id)}
                    className="flex items-center gap-3 rounded-xl border p-3 text-left transition"
                    style={selectedTempId === temp.id
                      ? { borderColor: ROLE_COLORS[assigningRole] ?? "#6b7280", backgroundColor: "#f0f9ff" }
                      : { borderColor: "#e5e7eb", background: "white" }}>
                    <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                      style={{ backgroundColor: ROLE_COLORS[temp.role] ?? "#6b7280" }}>
                      {temp.name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-slate-700">{temp.name}</div>
                      <div className="text-xs text-slate-400">{temp.role} · {temp.phone}</div>
                    </div>
                    <div className="text-amber-400 text-xs">{"★".repeat(temp.rating)}</div>
                    {selectedTempId === temp.id && (
                      <span className="text-xs font-bold" style={{ color: ROLE_COLORS[assigningRole] ?? "#6b7280" }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
              <button onClick={handleAssignTemp}
                disabled={!selectedTempId || (assigningRole === "Assistant" && !selectedDentistId)}
                className="w-full rounded-xl py-2.5 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
                style={{ backgroundColor: ROLE_COLORS[assigningRole] ?? "#6b7280" }}>
                {assigningRole === "Assistant" && !selectedDentistId ? "Select a dentist first" : "Confirm Assignment"}
              </button>
            </div>
          )}
        </div>
      )}

      {tempAssignments.length > 0 && (
        <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-4">
          <p className="text-sm font-semibold text-teal-700 mb-3">🔄 Temp Staff Assigned</p>
          <div className="space-y-2">
            {tempAssignments.map((ta) => {
              const temp = temps.find((t) => t.id === ta.tempId);
              const dentistName = ta.role === "Assistant" ? getTempDentistName(ta.notes) : "";
              return (
                <div key={ta.id} className="flex items-center justify-between rounded-xl bg-white border border-teal-100 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: ROLE_COLORS[ta.role] ?? "#6b7280" }}>
                      {temp?.name.charAt(0) ?? "?"}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-700">{temp?.name ?? "Unknown"}</div>
                      <div className="text-xs text-slate-400">
                        {ta.role}{dentistName ? ` → ${dentistName}` : ""}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => handleRemoveTemp(ta.id)}
                    className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded px-2 py-1 transition">
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
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

              const tempForDentist = tempAssignments.find(
                (ta) => ta.role === "Assistant" && ta.notes === `dentist:${dentist.id}`
              );
              const tempName = tempForDentist ? temps.find((t) => t.id === tempForDentist.tempId)?.name : null;

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
                          <select className="rounded border border-slate-200 px-2 py-1 text-xs"
                            defaultValue={resolvedAssistant?.id ?? ""}
                            onChange={(e) => handleOverride(dentist.id, e.target.value)}>
                            <option value="">No Assistant</option>
                            {getAvailableAssistantsFor(dentist.id).map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                          <button onClick={() => setSwapping(null)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
                        </div>
                      ) : (
                        <>
                          <span className={`text-sm flex items-center gap-1.5 ${resolvedAssistant || tempName ? "text-slate-600" : "text-amber-500"}`}>
                            {tempName ? (
                              <>
                                <span className="h-2 w-2 rounded-full bg-teal-400" />
                                {tempName} <span className="text-xs text-teal-500">(temp)</span>
                              </>
                            ) : resolvedAssistant ? (
                              <>
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: resolvedAssistant.color }} />
                                {resolvedAssistant.name}
                                {isOverridden && (
                                  <button onClick={() => handleClearOverride(dentist.id)} className="text-xs text-cyan-500 ml-1 hover:text-red-400">
                                    (manual ✕)
                                  </button>
                                )}
                              </>
                            ) : "No Assistant"}
                          </span>
                          {!tempName && (
                            <div className="flex gap-1">
                              <button onClick={() => setSwapping(dentist.id)}
                                className="rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-200 hover:text-slate-600 transition">
                                swap
                              </button>
                              <button onClick={() => { setAssigningRole("Assistant"); setSelectedDentistId(dentist.id); setSelectedTempId(""); }}
                                className="rounded px-1.5 py-0.5 text-xs text-teal-400 hover:bg-teal-50 hover:text-teal-600 transition">
                                + temp
                              </button>
                            </div>
                          )}
                          {tempName && (
                            <button onClick={() => {
                              const ta = tempAssignments.find((t) => t.role === "Assistant" && t.notes === `dentist:${dentist.id}`);
                              if (ta) handleRemoveTemp(ta.id);
                            }} className="text-xs text-red-400 hover:text-red-600 rounded px-1.5 py-0.5 transition">
                              remove
                            </button>
                          )}
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
        {assignments.frontDesk.length === 0 && !(tempsByRole["Front Desk"]?.length) ? (
          <p className="text-sm text-slate-400">None available</p>
        ) : (
          <div className="space-y-1">
            {assignments.frontDesk.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                {e.name}
              </div>
            ))}
            {(tempsByRole["Front Desk"] ?? []).map(({ assignment, temp }) => (
              <div key={assignment.id} className="flex items-center justify-between rounded-lg bg-teal-50 border border-teal-100 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-teal-400" />
                  {temp?.name ?? "Unknown"} <span className="text-xs text-teal-500 ml-1">(temp)</span>
                </span>
                <button onClick={() => handleRemoveTemp(assignment.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border p-4">
        <h3 className="mb-3 font-semibold text-slate-700">Hygienist/Assisted Hygiene</h3>
        {assignments.hygienists.length === 0 && !(tempsByRole["Hygienist"]?.length) ? (
          <p className="text-sm text-slate-400">None available</p>
        ) : (
          <div className="space-y-1">
            {assignments.hygienists.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                {e.name}
              </div>
            ))}
            {(tempsByRole["Hygienist"] ?? []).map(({ assignment, temp }) => (
              <div key={assignment.id} className="flex items-center justify-between rounded-lg bg-teal-50 border border-teal-100 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-teal-400" />
                  {temp?.name ?? "Unknown"} <span className="text-xs text-teal-500 ml-1">(temp)</span>
                </span>
                <button onClick={() => handleRemoveTemp(assignment.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
