export interface DailySchedule {
  date: string;

  dentists: number[];

  assistants: number[];

  frontDesk: number[];

  hygienists: number[];
}

export type ScheduleData = Record<string, DailySchedule>;