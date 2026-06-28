"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import AvailabilityGrid from "@/components/availability/AvailabilityGrid";

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default function AvailabilityPage() {
  const [month, setMonth] = useState(6); // July
  const [year, setYear] = useState(2026);

  return (
    <main className="min-h-screen bg-slate-50">
      <Sidebar />

      <div className="ml-64 p-8">
        <h1 className="mb-2 text-3xl font-bold">
          Staff Availability
        </h1>

        <p className="mb-6 text-slate-600">
          Set employee availability for each workday.
        </p>

        <div className="mb-6 flex items-center gap-4">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-lg border p-2"
          >
            {months.map((name, index) => (
              <option key={index} value={index}>
                {name}
              </option>
            ))}
          </select>

          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-28 rounded-lg border p-2"
          />
        </div>

        <AvailabilityGrid
          year={year}
          month={month}
        />
      </div>
    </main>
  );
}