"use client";

import { useState } from "react";

import DentistSelector from "../../components/DentistSelector";
import DailyRequirements from "../../components/DailyRequirements";
import MonthlyPlanner from "../../components/MonthlyPlanner";
import DailyAssignmentPanel from "../../components/DailyAssignmentPanel";

export default function SchedulePage() {
  const [selectedDentists, setSelectedDentists] = useState<number[]>([]);
  const [selectedDate, setSelectedDate] = useState("");

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        <DentistSelector
          selected={selectedDentists}
          onChange={setSelectedDentists}
        />

        <DailyRequirements
          dentistCount={selectedDentists.length}
        />

        <MonthlyPlanner
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />

        <DailyAssignmentPanel
          selectedDate={selectedDate}
        />

      </div>
    </main>
  );
}