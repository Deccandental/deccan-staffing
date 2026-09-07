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
    <main className="min-h-screen bg-slate-100">
      <Sidebar />
      <section className="ml-64 space-y-8 p-8">
        <h1 className="text-4xl font-bold">Monthly Planner</h1>
        <p className="text-slate-600">Build and manage your monthly staffing schedule.</p>

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
