"use client";

import { useState } from "react";

import { Sidebar } from "@/components/Sidebar";
import DentistSelector from "@/components/DentistSelector";
import DailyRequirements from "@/components/planner/DailyRequirements";
import DailyAssignments from "@/components/planner/DailyAssignments";
import MonthlyPlanner from "@/components/MonthlyPlanner";

export interface AssistantOverride {
  [dentist: string]: string;
}

export default function SchedulePage() {
  const [selectedDentists, setSelectedDentists] = useState<string[]>([]);

  const [selectedDate, setSelectedDate] = useState("");

  const [assistantOverrides, setAssistantOverrides] =
    useState<AssistantOverride>({});

  return (
    <main className="min-h-screen bg-slate-100">
      <Sidebar />

      <section className="ml-64 space-y-8 p-8">

        <h1 className="text-4xl font-bold">
          Monthly Planner
        </h1>

        <p className="text-slate-600">
          Build and manage your monthly staffing schedule.
        </p>

        <DentistSelector
          selectedDentists={selectedDentists}
          setSelectedDentists={setSelectedDentists}
        />

        <DailyRequirements
          dentistsWorking={selectedDentists.length}
        />

        <DailyAssignments
          dentistsWorking={selectedDentists}
          overrides={assistantOverrides}
          setOverrides={setAssistantOverrides}
        />

        <MonthlyPlanner
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />

      </section>
    </main>
  );
}