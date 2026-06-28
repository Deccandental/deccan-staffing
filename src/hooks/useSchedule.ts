"use client";

import { useState } from "react";
import { ScheduleData } from "../types/schedule";

export function useSchedule() {
  const [schedule, setSchedule] = useState<ScheduleData>({});

  function getDay(date: string) {
    return (
      schedule[date] || {
        date,
        dentists: [],
        assistants: [],
        frontDesk: [],
        hygienists: [],
      }
    );
  }

  function updateDay(date: string, updates: Partial<ReturnType<typeof getDay>>) {
    setSchedule((current) => ({
      ...current,
      [date]: {
        ...getDay(date),
        ...updates,
      },
    }));
  }

  return {
    schedule,
    getDay,
    updateDay,
  };
}