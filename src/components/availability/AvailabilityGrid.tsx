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
    <div className="rounded-2xl bg-white shadow overflow-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white border p-3 text-left min-w-[220px]">
              Employee
            </th>

            {days.map((day) => (
              <th
                key={day.date}
                className="border p-2 min-w-[58px] text-center"
              >
                <div className="font-semibold">
                  {day.day}
                </div>

                <div className="text-xs text-gray-500">
                  {day.weekday}
                </div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {employees.map((employee) => (
            <tr key={employee.id}>
              <td className="sticky left-0 bg-white border p-3">
                <div className="flex items-center gap-3">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: employee.color,
                    }}
                  />

                  <div>
                    <div className="font-medium">
                      {employee.name}
                    </div>

                    <div className="text-xs text-gray-500">
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
                      type="button"
                      onClick={() =>
                        toggle(employee.id, day.date)
                      }
                      className={`w-6 h-6 rounded-full transition ${
                        available
                          ? "bg-green-500 hover:bg-green-600"
                          : "bg-red-500 hover:bg-red-600"
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