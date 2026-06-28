"use client";

import { useState } from "react";
import { employees } from "@/data/employees";
import { generateMonth } from "@/utils/calendar";

interface Props {
  year: number;
  month: number;
}

export default function AvailabilityGrid({
  year,
  month,
}: Props) {
  const days = generateMonth(year, month);

  const [availability, setAvailability] = useState<
    Record<string, boolean>
  >({});

  function toggle(employeeId: number, date: string) {
    const key = `${employeeId}-${date}`;

    setAvailability((current) => ({
      ...current,
      [key]: !(current[key] ?? true),
    }));
  }

  return (
    <div className="overflow-auto rounded-xl border bg-white shadow">
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-100">
          <tr>
            <th className="border p-3 text-left min-w-[230px]">
              Employee
            </th>

            {days.map((day) => (
              <th
                key={day.date}
                className="border p-2 min-w-[58px]"
              >
                <div className="font-bold">
                  {day.day}
                </div>

                <div className="text-xs text-slate-500">
                  {day.weekday}
                </div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {employees.map((employee) => (
            <tr key={employee.id}>
              <td className="border p-3">
                <div className="flex items-center gap-3">
                  <div
                    className="h-4 w-4 rounded-full"
                    style={{
                      backgroundColor: employee.color,
                    }}
                  />

                  <div>
                    <div className="font-semibold">
                      {employee.name}
                    </div>

                    <div className="text-xs text-slate-500">
                      {employee.role}
                    </div>
                  </div>
                </div>
              </td>

              {days.map((day) => {
                const key = `${employee.id}-${day.date}`;

                const available =
                  availability[key] ??
                  employee.defaultSchedule[
                    day.weekday.toLowerCase() as keyof typeof employee.defaultSchedule
                  ];

                return (
                  <td
                    key={key}
                    className="border text-center"
                  >
                    <button
                      onClick={() =>
                        toggle(employee.id, day.date)
                      }
                      className={`h-7 w-7 rounded-full transition hover:scale-110 ${
                        available
                          ? "bg-green-500"
                          : "bg-red-500"
                      }`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}