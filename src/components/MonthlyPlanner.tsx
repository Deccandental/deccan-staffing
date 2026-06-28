"use client";

import { employees } from "../data/employees";
import type { Employee } from "../types/employee";
import { generateMonth } from "../utils/calendar";

interface MonthlyPlannerProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

const month = generateMonth(2026, 6);

export default function MonthlyPlanner({
  selectedDate,
  onSelectDate,
}: MonthlyPlannerProps) {
  return (
    <div className="bg-white rounded-2xl shadow p-6 overflow-auto">
      <h2 className="text-2xl font-bold mb-2">
        Monthly Staffing Planner
      </h2>

      <p className="text-gray-500 mb-6">
        Click a day to schedule staff.
      </p>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left p-3 w-64">Employee</th>

            {month.map((day) => (
              <th
                key={day.date}
                className={`border-l p-2 text-center text-sm cursor-pointer transition ${
                  selectedDate === day.date
                    ? "bg-blue-600 text-white"
                    : "hover:bg-blue-100"
                }`}
                onClick={() => onSelectDate(day.date)}
              >
                <div>{day.weekday}</div>
                <div className="font-bold">{day.day}</div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {employees.map((employee: Employee) => (
            <tr key={employee.id} className="border-b">
              <td className="p-3 whitespace-nowrap font-medium">
                <span
                  className="inline-block w-3 h-3 rounded-full mr-2"
                  style={{ backgroundColor: employee.color }}
                />
                {employee.name}
              </td>

              {month.map((day) => (
                <td
                  key={`${employee.id}-${day.date}`}
                  className={`border-l h-12 ${
                    selectedDate === day.date
                      ? "bg-blue-50"
                      : ""
                  }`}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}