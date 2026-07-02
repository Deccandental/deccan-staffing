export interface AvailabilityRecord {
  employeeId: number;
  date: string;
  available: boolean;
}

export const availability: AvailabilityRecord[] = [];