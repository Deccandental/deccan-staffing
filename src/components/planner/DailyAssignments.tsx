"use client";

import { buildAssignments } from "@/utils/scheduler";

interface Props {
  dentistsWorking: string[];
  overrides: Record<string, string>;
  setOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
}

const assistantChoices = [
  "Karla",
  "Stephanie",
  "Unique",
  "Cindy",
  "Temp Assistant",
];

export default function DailyAssignments({
  dentistsWorking,
  overrides,
  setOverrides,
}: Props) {

  const assignments = buildAssignments(dentistsWorking);

  function changeAssignment(
    dentist: string,
    assistant: string
  ) {
    setOverrides({
      ...overrides,
      [dentist]: assistant,
    });
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">

      <h2 className="mb-6 text-2xl font-bold">
        Automatic Assignments
      </h2>

      {/* Front Desk */}

      <div className="mb-8">

        <h3 className="mb-2 text-lg font-semibold">
          Front Desk
        </h3>

        {assignments.frontDesk.map((employee) => (
          <div
            key={employee.id}
            className="py-1"
          >
            ✅ {employee.name}
          </div>
        ))}

      </div>

      {/* Hygienist */}

      <div className="mb-8">

        <h3 className="mb-2 text-lg font-semibold">
          Hygienist
        </h3>

        {assignments.hygienists.map((employee) => (
          <div
            key={employee.id}
            className="py-1"
          >
            ✅ {employee.name}
          </div>
        ))}

      </div>

      {/* Dentist Assignments */}

      <div>

        <h3 className="mb-4 text-lg font-semibold">
          Dentist Assignments
        </h3>

        <div className="space-y-3">

          {assignments.assistants.map((assignment) => {

            const currentAssistant =
              overrides[assignment.dentist] ??
              assignment.assistant?.name ??
              "Temp Assistant";

            return (

              <div
                key={assignment.dentist}
                className="rounded-xl border p-4"
              >

                <div className="mb-2 font-semibold">
                  {assignment.dentist}
                </div>

                <select
                  value={currentAssistant}
                  onChange={(e) =>
                    changeAssignment(
                      assignment.dentist,
                      e.target.value
                    )
                  }
                  className="w-full rounded-lg border p-2"
                >

                  {assistantChoices.map((assistant) => (

                    <option
                      key={assistant}
                      value={assistant}
                    >
                      {assistant}
                    </option>

                  ))}

                </select>

              </div>

            );

          })}

        </div>

      </div>

    </div>
  );
}