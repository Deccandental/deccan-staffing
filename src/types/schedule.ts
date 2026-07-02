import { Employee } from "./employee";

export interface StaffAssignment {
  employeeId: number;
  role: string;
}

export interface DailySchedule {
  date: string;
  dentists: string[];
  assignments: StaffAssignment[];
}

export interface MonthlySchedule {
  year: number;
  month: number;
  days: DailySchedule[];
}

export interface AssistantOverride {
  dentist: string;
  assistantId: number;
}

export interface ScheduleState {
  employees: Employee[];
  monthlySchedule: MonthlySchedule;
}