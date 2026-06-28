"use client";

import { employees } from "@/data/employees";

export default function StaffTable() {
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-100">
          <tr>
            <th className="p-3 text-left">Name</th>
            <th className="p-3 text-left">Role</th>
            <th className="p-3 text-left">Skills</th>
            <th className="p-3 text-left">Status</th>
          </tr>
        </thead>

        <tbody>
          {employees.map((employee) => (
            <tr
              key={employee.id}
              className="border-t hover:bg-slate-50"
            >
              <td className="p-3">
                <div className="flex items-center gap-3">
                  <div
                    className="h-4 w-4 rounded-full"
                    style={{
                      backgroundColor: employee.color,
                    }}
                  />

                  {employee.name}
                </div>
              </td>

              <td className="p-3">
                {employee.role}
              </td>

              <td className="p-3">
                {employee.skills.join(", ")}
              </td>

              <td className="p-3">
                {employee.active ? (
                  <span className="rounded bg-green-100 px-2 py-1 text-green-700">
                    Active
                  </span>
                ) : (
                  <span className="rounded bg-red-100 px-2 py-1 text-red-700">
                    Inactive
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}