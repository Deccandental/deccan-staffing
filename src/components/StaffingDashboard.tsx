"use client";

import { useState } from "react";
import MonthlyPlanner from "./MonthlyPlanner";
import DailyAssignmentPanel from "./DailyAssignmentPanel";
import DailyRequirements from "./planner/DailyRequirements";
import DentistSelector from "./DentistSelector";
import StaffTable from "./StaffTable";
import PrintSchedule from "./PrintSchedule";
import { useSchedule } from "@/hooks/useSchedule";

export default function StaffingDashboard() {
  const today = new Date();
  const [printYear] = useState(today.getFullYear());
  const [printMonth] = useState(today.getMonth() + 1);

  const {
    selectedDate,
    setSelectedDate,
    allDentists,
    workingDentists,
    setWorkingDentists,
    dentistCount,
    assignments,
    schedule,
  } = useSchedule();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div />
        <PrintSchedule year={printYear} month={printMonth} schedule={schedule} />
      </div>

      <MonthlyPlanner
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      {selectedDate ? (
        <>
          <DentistSelector
            dentists={allDentists}
            selected={workingDentists}
            onChange={setWorkingDentists}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <DailyRequirements dentistCount={dentistCount} />
            <DailyAssignmentPanel
              selectedDate={selectedDate}
              assignments={assignments}
            />
          </div>
        </>
      ) : (
        <div className="rounded-2xl bg-white p-8 text-center shadow">
          <p className="text-slate-400 text-lg">
            ← Select an open day on the calendar to manage staffing
          </p>
        </div>
      )}

      <StaffTable />
    </div>
  );
}
