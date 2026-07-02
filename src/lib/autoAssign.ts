import { Employee } from "@/types/employee";
import { getWeekday } from "./dateUtils";
import {
  availableAssistants,
  availableFrontDesk,
  availableHygienists,
} from "./availabilityEngine";

export interface AutoAssignmentResult {
  assistants: Employee[];
  frontDesk: Employee[];
  hygienists: Employee[];
}

export function autoAssign(
  employees: Employee[],
  date: string,
  dentistCount: number
): AutoAssignmentResult {
  const weekday = getWeekday(date);

  const assistants = availableAssistants(
    employees,
    weekday
  ).slice(0, dentistCount);

  const frontDesk = availableFrontDesk(
    employees,
    weekday
  ).slice(0, 2);

  const hygienists = availableHygienists(
    employees,
    weekday
  ).slice(0, 1);

  return {
    assistants,
    frontDesk,
    hygienists,
  };
}