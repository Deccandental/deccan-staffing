import { DailySchedule } from "./monthlySchedule";

export interface MonthlySummary {
  totalDays: number;
  totalDentists: number;
  totalAssistants: number;
  totalFrontDesk: number;
  totalHygienists: number;
  warningCount: number;
}

export function summarizeSchedule(
  schedule: DailySchedule[]
): MonthlySummary {
  return schedule.reduce<MonthlySummary>(
    (summary, day) => {
      summary.totalDays += 1;
      summary.totalDentists += day.dentistCount;
      summary.totalAssistants += day.assistants.length;
      summary.totalFrontDesk += day.frontDesk.length;
      summary.totalHygienists += day.hygienists.length;
      summary.warningCount += day.warnings.length;

      return summary;
    },
    {
      totalDays: 0,
      totalDentists: 0,
      totalAssistants: 0,
      totalFrontDesk: 0,
      totalHygienists: 0,
      warningCount: 0,
    }
  );
}