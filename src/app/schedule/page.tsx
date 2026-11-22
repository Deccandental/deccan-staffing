"use client";

import { Sidebar } from "@/components/Sidebar";
import MonthlyPlanner from "@/components/MonthlyPlanner";
import DentistSelector from "@/components/DentistSelector";
import DailyRequirements from "@/components/planner/DailyRequirements";
import DailyAssignments from "@/components/planner/DailyAssignments";
import { useSchedule } from "@/hooks/useSchedule";

const dentists = [
  "Dr. Nanjapa",
  "Dr. Coulter",
  "Dr. Viraparia",
  "Dr. Ho",
];

export default function SchedulePage() {
  const {
    selectedDate,
    setSelectedDate,
    workingDentists,
    setWorkingDentists,
    dentistCount,
    assignments,
  } = useSchedule();

  return (
    <main className="app-shell">
      <Sidebar />
      <section className="ml-64 space-y-8 p-8">
        <h1 className="page-title">Monthly Planner</h1>
        <p className="page-subtitle">Build and manage your monthly staffing schedule.</p>

        <DentistSelector
          dentists={dentists}
          selected={workingDentists}
          onChange={setWorkingDentists}
        />

        <DailyRequirements dentistCount={dentistCount} />

        <DailyAssignments
          selectedDate={selectedDate}
          assignments={assignments}
        />

        <MonthlyPlanner
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      </section>
    </main>
  );
}
