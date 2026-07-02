import { employees } from "../data/employees";

export default function StaffTable() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-6 text-2xl font-bold">
        Staff Directory
      </h2>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3">Name</th>
            <th className="p-3">Role</th>
            <th className="p-3">Skills</th>
          </tr>
        </thead>

        <tbody>
          {employees.map((employee) => (
            <tr
              key={employee.id}
              className="border-b hover:bg-gray-50"
            >
              <td className="p-3 font-medium">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}