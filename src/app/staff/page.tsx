import { employees } from "@/data/employees";

export default function StaffPage() {
  const grouped = {
    Dentists: employees.filter((e) => e.role === "Dentist"),
    "Front Desk": employees.filter((e) => e.role === "Front Desk"),
    Assistants: employees.filter((e) => e.role === "Assistant"),
    Hygienists: employees.filter((e) => e.role === "Hygienist"),
  };

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold">Staff</h1>
        <p className="text-gray-600 mt-2">
          Manage all employees in Deccan Staffing
        </p>

        <div className="grid md:grid-cols-2 gap-6 mt-8">
          {Object.entries(grouped).map(([title, list]) => (
            <div
              key={title}
              className="bg-white rounded-xl shadow p-6"
            >
              <h2 className="text-2xl font-semibold mb-4">
                {title}
              </h2>

              <div className="space-y-3">
                {list.map((employee) => (
                  <div
                    key={employee.id}
                    className="border rounded-lg p-3"
                  >
                    <div className="font-semibold">
                      {employee.name}
                    </div>

                    <div className="text-sm text-gray-500">
                      Skills: {employee.skills.join(", ")}
                    </div>

                    <div className="text-green-600 text-sm mt-1">
                      ● Active
                    </div>
                  </div>
                ))}
              </div>

              <button className="mt-6 w-full rounded-lg bg-blue-600 text-white py-2 hover:bg-blue-700">
                + Add Employee
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}