import { employees } from "@/data/employees";
import { officeRules } from "@/data/officeRules";
import { Employee } from "@/types/employee";

export interface DailyAssignments {
  frontDesk: Employee[];
  assistants: {
    dentist: string;
    assistant: Employee | null;
  }[];
  hygienists: Employee[];
  tempAssistantsNeeded: number;
  tempFrontDeskNeeded: number;
}

export function buildAssignments(
  dentistsWorking: string[]
): DailyAssignments {
  const available = employees.filter(
    (employee) => employee.active
  );

  //----------------------------------
  // FRONT DESK
  //----------------------------------

  const frontDesk: Employee[] = [];

  const frontDeskPriority = [
    "Ketki",
    "Ari",
    "Karla",
  ];

  for (const name of frontDeskPriority) {
    if (
      frontDesk.length >=
      officeRules.frontDeskRequired
    ) {
      break;
    }

    const employee = available.find(
      (e) => e.name === name
    );

    if (employee) {
      frontDesk.push(employee);
    }
  }

  //----------------------------------
  // HYGIENIST
  //----------------------------------

  const hygienists: Employee[] = [];

  if (officeRules.hygienistsRequired > 0) {
    const cindy = available.find(
      (e) => e.name === "Cindy"
    );

    if (cindy) {
      hygienists.push(cindy);
    }
  }

  //----------------------------------
  // RESERVED EMPLOYEES
  //----------------------------------

  const reserved = new Set<number>();

  frontDesk.forEach((employee) =>
    reserved.add(employee.id)
  );

  hygienists.forEach((employee) =>
    reserved.add(employee.id)
  );

  //----------------------------------
  // ASSISTANT POOL
  //----------------------------------

  const assistantPool = available.filter(
    (employee) =>
      employee.skills.includes("Assistant") &&
      !reserved.has(employee.id)
  );

  //----------------------------------
  // DENTIST ASSIGNMENTS
  //----------------------------------

  const assistants: {
    dentist: string;
    assistant: Employee | null;
  }[] = [];

  for (const dentist of dentistsWorking) {
    let assigned: Employee | null = null;

    const preferences =
      officeRules.dentists[
        dentist as keyof typeof officeRules.dentists
      ] || [];

    for (const preferred of preferences) {
      const employee = assistantPool.find(
        (assistant) =>
          assistant.name === preferred
      );

      if (employee) {
        assigned = employee;

        assistantPool.splice(
          assistantPool.indexOf(employee),
          1
        );

        break;
      }
    }

    assistants.push({
      dentist,
      assistant: assigned,
    });
  }

  //----------------------------------

  return {
    frontDesk,

    assistants,

    hygienists,

    tempAssistantsNeeded:
      assistants.filter(
        (assignment) =>
          assignment.assistant === null
      ).length,

    tempFrontDeskNeeded: Math.max(
      0,
      officeRules.frontDeskRequired -
        frontDesk.length
    ),
  };
}