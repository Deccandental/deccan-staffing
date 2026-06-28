import { employees } from "../data/employees";

interface Props {
  selectedDate: string;
}

export default function DailyAssignmentPanel({
  selectedDate,
}: Props) {
  const dentists = employees.filter(
    (e) => e.role === "Dentist"
  );

  const assistants = employees.filter(
    (e) => e.skills.includes("Assistant")
  );

  const frontDesk = employees.filter(
    (e) => e.skills.includes("Front Desk")
  );

  const hygienists = employees.filter(
    (e) => e.role === "Hygienist"
  );

  return (
    <div className="bg-white rounded-2xl shadow p-6">

      <h2 className="text-2xl font-bold mb-6">
        Daily Assignments
      </h2>

      <p className="text-gray-500 mb-6">
        {selectedDate || "Select a day from the planner"}
      </p>

      <div className="space-y-6">

        <section>

          <h3 className="font-semibold mb-2">
            Dentists
          </h3>

          {dentists.map((d) => (
            <label
              key={d.id}
              className="block"
            >
              <input type="checkbox" className="mr-2" />
              {d.name}
            </label>
          ))}

        </section>

        <section>

          <h3 className="font-semibold mb-2">
            Assistants
          </h3>

          <select className="border rounded p-2 w-full">
            <option>Select Assistant</option>

            {assistants.map((a) => (
              <option key={a.id}>
                {a.name}
              </option>
            ))}

          </select>

        </section>

        <section>

          <h3 className="font-semibold mb-2">
            Front Desk
          </h3>

          <select className="border rounded p-2 w-full">
            <option>Select Front Desk</option>

            {frontDesk.map((f) => (
              <option key={f.id}>
                {f.name}
              </option>
            ))}

          </select>

        </section>

        <section>

          <h3 className="font-semibold mb-2">
            Hygienist
          </h3>

          <select className="border rounded p-2 w-full">
            <option>Select Hygienist</option>

            {hygienists.map((h) => (
              <option key={h.id}>
                {h.name}
              </option>
            ))}

          </select>

        </section>

      </div>

    </div>
  );
}