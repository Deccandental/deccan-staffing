import { Employee } from "@/types/employee";
import { employees as defaultEmployees } from "@/data/employees";

const STAFF_KEY = "deccan-staff-v1";
const PREFS_KEY = "deccan-prefs-v1";

export function loadStaff(): Employee[] {
  if (typeof window === "undefined") return defaultEmployees;
  try {
    const raw = localStorage.getItem(STAFF_KEY);
    if (!raw) return defaultEmployees;
    return JSON.parse(raw) as Employee[];
  } catch { return defaultEmployees; }
}

export function saveStaff(staff: Employee[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STAFF_KEY, JSON.stringify(staff));
}

export function addEmployee(emp: Omit<Employee, "id">): Employee {
  const staff = loadStaff();
  const id = Math.max(0, ...staff.map((e) => e.id)) + 1;
  const newEmp = { ...emp, id };
  saveStaff([...staff, newEmp]);
  return newEmp;
}

export function updateEmployee(updated: Employee) {
  saveStaff(loadStaff().map((e) => (e.id === updated.id ? updated : e)));
}

export function removeEmployee(id: number) {
  saveStaff(loadStaff().filter((e) => e.id !== id));
}

export type DentistPrefs = Record<number, number[]>;

export function loadPrefs(): DentistPrefs {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as DentistPrefs; }
  catch { return {}; }
}

export function savePrefs(prefs: DentistPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function setDentistPrefs(dentistId: number, assistantIds: number[]) {
  const prefs = loadPrefs();
  prefs[dentistId] = assistantIds;
  savePrefs(prefs);
}
