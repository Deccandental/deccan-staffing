import { Employee } from "@/types/employee";
import { AssistantOverrideValue, AssistantOverrides } from "./scheduleStore";

/**
 * Resolves the final list of assistants for one dentist on one day, combining:
 *  - the desired count for that dentist (default 1 if not set)
 *  - the engine's auto-assigned assistants (in slot order)
 *  - any manual per-slot overrides
 * Returns an array of exactly `count` entries; unfilled slots are null.
 */
export function resolveDentistAssistants(
  dentistId: number,
  autoAssigned: Employee[],
  assistantCounts: Record<number, number>,
  overrides: AssistantOverrides,
  staff: Employee[]
): (Employee | null)[] {
  const count = Math.max(0, assistantCounts[dentistId] ?? 1);
  const slotOverrides = getDentistSlotOverrides(overrides, dentistId);
  return Array.from({ length: count }, (_, i) => {
    if (i in slotOverrides) {
      const id = slotOverrides[i];
      return id != null ? staff.find((e) => e.id === id) ?? null : null;
    }
    return autoAssigned[i] ?? null;
  });
}

/**
 * Reads the per-slot override map for one dentist, transparently handling
 * both saved shapes:
 *  - legacy: assistantOverrides[dentistId] = assistantId | null  (slot 0 only)
 *  - current: assistantOverrides[dentistId] = { [slotIndex]: assistantId | null }
 */
export function getDentistSlotOverrides(
  overrides: AssistantOverrides,
  dentistId: number
): Record<number, number | null> {
  const value: AssistantOverrideValue | undefined = overrides[dentistId];
  if (value === undefined) return {};
  if (value === null || typeof value === "number") return { 0: value };
  return value;
}

/**
 * Returns a new AssistantOverrides map with one slot for one dentist set,
 * always writing the current (nested) shape — this naturally migrates a
 * dentist's entry away from the legacy shape the first time it's edited.
 */
export function setDentistSlotOverride(
  overrides: AssistantOverrides,
  dentistId: number,
  slotIndex: number,
  assistantId: number | null
): AssistantOverrides {
  const current = getDentistSlotOverrides(overrides, dentistId);
  return {
    ...overrides,
    [dentistId]: { ...current, [slotIndex]: assistantId },
  };
}

/** Clears a single slot override for a dentist, leaving other slots untouched. */
export function clearDentistSlotOverride(
  overrides: AssistantOverrides,
  dentistId: number,
  slotIndex: number
): AssistantOverrides {
  const current = { ...getDentistSlotOverrides(overrides, dentistId) };
  delete current[slotIndex];
  return { ...overrides, [dentistId]: current };
}
