"use client";

import { useState, useEffect } from "react";
import { DailyAssignmentsResult } from "@/lib/assignmentEngine";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import { AssistantOverrides } from "@/lib/scheduleStore";
import { resolveDentistAssistants, getDentistSlotOverrides, setDentistSlotOverride, clearDentistSlotOverride } from "@/lib/assistantSlots";
import { TempStaff } from "@/app/temps/page";
import { TempAssignment, getTempAssignments, addTempAssignment, removeTempAssignment } from "@/lib/tempAssignments";
import { supabase } from "@/lib/supabase";

interface Props {
  selectedDate: string;
  assignments?: DailyAssignmentsResult;
  assistantOverrides?: AssistantOverrides;
  onOverrideChange?: (overrides: AssistantOverrides) => void;
  assistantCounts?: Record<number, number>;
  onAssistantCountChange?: (dentistId: number, count: number) => void;
  hygienistsRequired?: number;
  hygienistOverrides?: Record<number, number | null>;
  onHygienistOverrideChange?: (overrides: Record<number, number | null>) => void;
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

export default function DailyAssignmentPanel({
  selectedDate, assignments = EMPTY, assistantOverrides = {}, onOverrideChange,
  assistantCounts = {}, onAssistantCountChange,
  hygienistsRequired, hygienistOverrides = {}, onHygienistOverrideChange,
  onTempAssignmentsChange,
}: Props) {
  const [overrides, setOverrides] = useState<AssistantOverrides>(assistantOverrides);
  const [hygOverrides, setHygOverrides] = useState<Record<number, number | null>>(hygienistOverrides);
  const [swapping, setSwapping] = useState<{ dentistId: number; slotIndex: number } | null>(null);
  const [hygSwapping, setHygSwapping] = useState<number | null>(null);
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
    setHygOverrides(hygienistOverrides);
    setSwapping(null);
    setHygSwapping(null);
    setAssigningRole(null);
    setSelectedTempId("");
    setSelectedDentistId(null);
    if (selectedDate) {
      getTempAssignments(selectedDate).then(setTempAssignments);
    }
  }, [selectedDate, JSON.stringify(assistantOverrides), JSON.stringify(hygienistOverrides)]);

  const dateLabel = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric",
      })
    : "";

  // Resolves the full, ordered list of assistants for one dentist, applying
  // any manual per-slot overrides on top of the engine's auto-assignment.
  function getResolvedSlots(dentistId: number): (Employee | null)[] {
    const autoAssigned = assignments.dentists.find((d) => d.dentist.id === dentistId)?.assistants ?? [];
    return resolveDentistAssistants(dentistId, autoAssigned, assistantCounts, overrides, staff);
  }

  // Available assistants for a specific dentist slot. Excludes people
  // currently working as a hygienist today (cross-role conflict, no auto
  // swap), and excludes anyone already filling ANOTHER slot for this SAME
  // dentist (no point offering a duplicate). Assistants already assigned to
  // a DIFFERENT dentist are still shown — picking one triggers a true swap
  // (see handleOverride) instead of creating a duplicate.
  function getAvailableAssistantsFor(dentistId: number, excludingSlot: number): Employee[] {
    const hygienistIds = new Set(resolvedHygienists.map((h) => h.id));
    const sameDentistOtherSlots = new Set(
      getResolvedSlots(dentistId)
        .filter((_, i) => i !== excludingSlot)
        .filter(Boolean)
        .map((e) => (e as Employee).id)
    );
    return staff.filter((e) => e.skills.includes("Assistant") && !hygienistIds.has(e.id) && !sameDentistOtherSlots.has(e.id));
  }

  // For showing "(currently with Dr. X)" hints in the swap dropdown — scans
  // every dentist's every slot except the one being edited.
  function getCurrentAssignmentFor(
    assistantId: number,
    excludingDentistId: number,
    excludingSlot: number
  ): { dentist: Employee; slotIndex: number } | null {
    for (const { dentist } of assignments.dentists) {
      const slots = getResolvedSlots(dentist.id);
      for (let i = 0; i < slots.length; i++) {
        if (dentist.id === excludingDentistId && i === excludingSlot) continue;
        if (slots[i]?.id === assistantId) return { dentist, slotIndex: i };
      }
    }
    return null;
  }

  // Hygienist slots: independent "seats" (0-indexed, up to hygienistsRequired)
  // rather than one slot per person, since hygienist need isn't tied to a
  // specific dentist. Slot N defaults to assignments.hygienists[N] (the
  // engine's priority pick — e.g. Cindy stays first choice) unless overridden.
  const hygSlotCount = hygienistsRequired ?? assignments.hygienists.length;
  const hygSlotsAuto: (Employee | null)[] = Array.from({ length: hygSlotCount }, (_, i) => assignments.hygienists[i] ?? null);

  function getHygienist(slotIndex: number): Employee | null {
    if (slotIndex in hygOverrides) {
      const ovId = hygOverrides[slotIndex];
      return ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
    }
    return hygSlotsAuto[slotIndex] ?? null;
  }

  const resolvedHygienists = Array.from({ length: hygSlotCount }, (_, i) => getHygienist(i)).filter(Boolean) as Employee[];

  // Available hygienists for a slot. Exclude people currently working as an
  // assistant today (cross-role conflict, no auto swap). People already in
  // ANOTHER hygienist slot are still shown — picking one triggers a true
  // swap (see handleHygOverride) instead of creating a duplicate.
  function getAvailableHygienistsFor(slotIndex: number): Employee[] {
    const assistantIds = new Set<number>();
    assignments.dentists.forEach(({ dentist }) => {
      getResolvedSlots(dentist.id).forEach((a) => { if (a) assistantIds.add(a.id); });
    });
    return staff.filter((e) => (e.role === "Hygienist" || e.skills.includes("Hygienist")) && !assistantIds.has(e.id));
  }

  // For showing "(swap with slot N's person)" hints in the hygienist dropdown.
  function getCurrentHygSlotFor(employeeId: number, excludingSlot: number): number | null {
    for (let i = 0; i < hygSlotCount; i++) {
      if (i === excludingSlot) continue;
      if (getHygienist(i)?.id === employeeId) return i;
    }
    return null;
  }

  function handleHygOverride(slotIndex: number, value: string) {
    const newId = value ? Number(value) : null;
    const newHygOverrides = { ...hygOverrides };

    if (newId !== null) {
      const currentAtSlot = getHygienist(slotIndex);
      const conflictingSlot = getCurrentHygSlotFor(newId, slotIndex);
      if (conflictingSlot !== null) {
        newHygOverrides[conflictingSlot] = currentAtSlot ? currentAtSlot.id : null;
      }
    }

    newHygOverrides[slotIndex] = newId;
    setHygOverrides(newHygOverrides);
    setHygSwapping(null);
    onHygienistOverrideChange?.(newHygOverrides);
  }

  function handleClearHygOverride(slotIndex: number) {
    const newHygOverrides = { ...hygOverrides };
    delete newHygOverrides[slotIndex];
    setHygOverrides(newHygOverrides);
    onHygienistOverrideChange?.(newHygOverrides);
  }

  function handleOverride(dentistId: number, slotIndex: number, value: string) {
    const newAssistantId = value ? Number(value) : null;
    let newOverrides = overrides;

    if (newAssistantId !== null) {
      // If this assistant is already filling a different slot (their own or
      // another dentist's) today, swap: give that slot whoever is currently
      // here, instead of leaving two slots pointing at the same person.
      const conflict = getCurrentAssignmentFor(newAssistantId, dentistId, slotIndex);
      if (conflict) {
        const currentAtThisSlot = getResolvedSlots(dentistId)[slotIndex];
        newOverrides = setDentistSlotOverride(newOverrides, conflict.dentist.id, conflict.slotIndex, currentAtThisSlot ? currentAtThisSlot.id : null);
      }
    }

    newOverrides = setDentistSlotOverride(newOverrides, dentistId, slotIndex, newAssistantId);
    setOverrides(newOverrides);
    setSwapping(null);
    onOverrideChange?.(newOverrides);
  }

  function handleClearOverride(dentistId: number, slotIndex: number) {
    const newOverrides = clearDentistSlotOverride(overrides, dentistId, slotIndex);
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

  // Determine which dentists still need at least one assistant (some empty
  // slot, no override filling it, no temp covering the dentist).
  const dentistsStillNeedingAssistant = assignments.dentists.filter((d) => {
    const hasTemp = tempAssignments.some((ta) => ta.role === "Assistant" && ta.notes === `dentist:${d.dentist.id}`);
    if (hasTemp) return false;
    return getResolvedSlots(d.dentist.id).some((slot) => slot === null);
  });

  const hygienistStillNeeded = resolvedHygienists.length === 0 && hygSlotCount > 0 && (tempsByRole["Hygienist"]?.length ?? 0) === 0 && assignments.dentists.length > 0;
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
        const hasAnyOverride = Object.keys(getDentistSlotOverrides(overrides, dentistMatch.dentist.id)).length > 0;
        return !hasTemp && !hasAnyOverride;
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
          <div className="space-y-3">
            {assignments.dentists.map(({ dentist }) => {
              const count = Math.max(0, assistantCounts[dentist.id] ?? 1);
              const resolvedSlots = getResolvedSlots(dentist.id);
              const slotOverrides = getDentistSlotOverrides(overrides, dentist.id);

              const tempForDentist = tempAssignments.find(
                (ta) => ta.role === "Assistant" && ta.notes === `dentist:${dentist.id}`
              );
              const tempName = tempForDentist ? temps.find((t) => t.id === tempForDentist.tempId)?.name : null;

              return (
                <div key={dentist.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium text-sm">
                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dentist.color }} />
                      {dentist.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="mr-1 text-xs text-slate-400">Assistants</span>
                      {[0, 1, 2, 3].map((n) => (
                        <button key={n} onClick={() => onAssistantCountChange?.(dentist.id, n)}
                          className="rounded px-2 py-0.5 text-xs font-semibold transition"
                          style={count === n ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280", border: "1px solid #e5e7eb" }}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {count === 0 && !tempName && (
                    <p className="pl-4 text-xs text-slate-400">No assistant needed today</p>
                  )}

                  <div className="space-y-1.5">
                    {resolvedSlots.map((resolvedAssistant, slotIndex) => {
                      const isOverridden = slotIndex in slotOverrides;
                      const isSwapping = swapping?.dentistId === dentist.id && swapping?.slotIndex === slotIndex;
                      return (
                        <div key={slotIndex} className="flex items-center justify-between pl-4">
                          {count > 1 && <span className="w-14 flex-shrink-0 text-xs text-slate-400">#{slotIndex + 1}</span>}
                          <div className="ml-auto flex items-center gap-2">
                            {isSwapping ? (
                              <div className="flex items-center gap-1">
                                <select className="rounded border border-slate-200 px-2 py-1 text-xs"
                                  defaultValue={resolvedAssistant?.id ?? ""}
                                  onChange={(e) => handleOverride(dentist.id, slotIndex, e.target.value)}>
                                  <option value="">No Assistant</option>
                                  {getAvailableAssistantsFor(dentist.id, slotIndex).map((a) => {
                                    const conflict = getCurrentAssignmentFor(a.id, dentist.id, slotIndex);
                                    return (
                                      <option key={a.id} value={a.id}>
                                        {a.name}{conflict ? ` (swap with ${conflict.dentist.name})` : ""}
                                      </option>
                                    );
                                  })}
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
                                        <button onClick={() => handleClearOverride(dentist.id, slotIndex)} className="text-xs text-cyan-500 ml-1 hover:text-red-400">
                                          (manual ✕)
                                        </button>
                                      )}
                                    </>
                                  ) : "No Assistant"}
                                </span>
                                <button onClick={() => setSwapping({ dentistId: dentist.id, slotIndex })}
                                  className="rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-200 hover:text-slate-600 transition">
                                  swap
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    <div className="flex items-center justify-between pl-4">
                      {tempName ? (
                        <>
                          <span className="text-sm flex items-center gap-1.5 text-slate-600">
                            <span className="h-2 w-2 rounded-full bg-teal-400" />
                            {tempName} <span className="text-xs text-teal-500">(temp)</span>
                          </span>
                          <button onClick={() => {
                            const ta = tempAssignments.find((t) => t.role === "Assistant" && t.notes === `dentist:${dentist.id}`);
                            if (ta) handleRemoveTemp(ta.id);
                          }} className="text-xs text-red-400 hover:text-red-600 rounded px-1.5 py-0.5 transition">
                            remove
                          </button>
                        </>
                      ) : (
                        <button onClick={() => { setAssigningRole("Assistant"); setSelectedDentistId(dentist.id); setSelectedTempId(""); }}
                          className="rounded px-1.5 py-0.5 text-xs text-teal-400 hover:bg-teal-50 hover:text-teal-600 transition">
                          + temp
                        </button>
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
        {hygSlotCount === 0 && !(tempsByRole["Hygienist"]?.length) ? (
          <p className="text-sm text-slate-400">None needed today</p>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: hygSlotCount }, (_, slotIndex) => {
              const resolved = getHygienist(slotIndex);
              const isOverridden = slotIndex in hygOverrides;
              return (
                <div key={slotIndex} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">Hygienist {hygSlotCount > 1 ? slotIndex + 1 : ""}</span>
                    <div className="flex items-center gap-2">
                      {hygSwapping === slotIndex ? (
                        <div className="flex items-center gap-1">
                          <select className="rounded border border-slate-200 px-2 py-1 text-xs"
                            defaultValue={resolved?.id ?? ""}
                            onChange={(e) => handleHygOverride(slotIndex, e.target.value)}>
                            <option value="">No Hygienist</option>
                            {getAvailableHygienistsFor(slotIndex).map((h) => {
                              const currentlyAtSlot = getCurrentHygSlotFor(h.id, slotIndex);
                              return (
                                <option key={h.id} value={h.id}>
                                  {h.name}{currentlyAtSlot !== null && hygSlotCount > 1 ? ` (swap with #${currentlyAtSlot + 1})` : ""}
                                </option>
                              );
                            })}
                          </select>
                          <button onClick={() => setHygSwapping(null)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
                        </div>
                      ) : (
                        <>
                          <span className={`text-sm flex items-center gap-1.5 ${resolved ? "text-slate-600" : "text-amber-500"}`}>
                            {resolved ? (
                              <>
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: resolved.color }} />
                                {resolved.name}
                                {isOverridden && (
                                  <button onClick={() => handleClearHygOverride(slotIndex)} className="text-xs text-cyan-500 ml-1 hover:text-red-400">
                                    (manual ✕)
                                  </button>
                                )}
                              </>
                            ) : "No Hygienist"}
                          </span>
                          <button onClick={() => setHygSwapping(slotIndex)}
                            className="rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-200 hover:text-slate-600 transition">
                            swap
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
