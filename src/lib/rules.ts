import { DailySchedule } from "./monthlySchedule";

export interface RuleViolation {
  severity: "warning" | "error";
  message: string;
}

export function evaluateSchedule(
  schedule: DailySchedule
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  if (schedule.dentistCount > schedule.assistants.length) {
    violations.push({
      severity: "error",
      message:
        "Not enough assistants assigned for the number of dentists.",
    });
  }

  if (schedule.frontDesk.length < 2) {
    violations.push({
      severity: "error",
      message:
        "Two front desk staff are required.",
    });
  }

  if (schedule.hygienists.length < 1) {
    violations.push({
      severity: "warning",
      message:
        "No hygienist assigned.",
    });
  }

  if (schedule.warnings.length > 0) {
    schedule.warnings.forEach((warning) =>
      violations.push({
        severity: "warning",
        message: warning,
      })
    );
  }

  return violations;
}