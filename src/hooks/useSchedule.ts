"use client";

import { useMemo, useState } from "react";
import { employees } from "@/data/employees";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { getWeekday } from "@/lib/dateUtils";

interface DaySchedule {
  dentists: string[];
}

export function useSchedule() {
  const [selectedDate, setSelectedDate] = useState("");
  const [schedule, setSchedule] = useState<Record<string, DaySchedule>>({});

  const allDentists = employees
    .filter((e) => e.role === "Dentist")
    .map((e) => e.name);

  const workingDentists =
    selectedDate && schedule[selectedDate]
      ? schedule[selectedDate].dentists
      : [];

  function setWorkingDentists(dentists: string[]) {
    if (!selectedDate) return;
    setSchedule((current) => ({
      ...current,
      [selectedDate]: { dentists },
    }));
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    if (!schedule[date]) {
      const dowKey = getWeekday(date);
      const defaultDentists = employees
        .filter((e) => e.role === "Dentist" && e.defaultSchedule[dowKey])
        .map((e) => e.name);

      setSchedule((current) => ({
        ...current,
        [date]: { dentists: defaultDentists },
      }));
    }
  }

  const assignments = useMemo(() => {
    return buildDailyAssignments(employees, workingDentists, selectedDate || undefined);
  }, [workingDentists, selectedDate]);

  const dentistCount = assignments.dentists.length;

  return {
    selectedDate,
    setSelectedDate: handleSelectDate,
    allDentists,
    workingDentists,
    setWorkingDentists,
    assignments,
    dentistCount,
    schedule,
  };
}
