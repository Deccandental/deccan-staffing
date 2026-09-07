"use client";

import { DailyAssignmentsResult } from "@/lib/assignmentEngine";

interface Props {
  dentistCount: number;
  assignments?: DailyAssignmentsResult;
}

export default function DailyRequirements({ dentistCount, assignments }: Props) {
  const assistantsRequired = dentistCount;
  const assistantsAssigned = assignments?.dentists.filter((d) => d.assistant !== null).length ?? 0;
  const frontDeskAssigned = assignments?.frontDesk.length ?? 0;
  const hygienistsAssigned = assignments?.hygienists.length ?? 0;

  const assistantShort = assistantsAssigned < assistantsRequired;
  const frontDeskShort = frontDeskAssigned < 2;
  const hygienistShort = hygienistsAssigned < 1 && dentistCount > 0;

  function StatusRow({ label, required, assigned, short }: { label: string; required: number; assigned: number; short: boolean }) {
    return (
      <div className={`flex items-center justify-between rounded-xl border p-4 ${short ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
        <div>
          <span className="font-medium text-sm" style={{ color: "#5a5a5a" }}>{label}</span>
          {short && (
            <div className="text-xs text-red-500 mt-0.5">
              ⚠ {required - assigned} temp needed
            </div>
          )}
        </div>
        <div className="text-right">
          <span className={`font-bold text-lg ${short ? "text-red-600" : "text-green-600"}`}>
            {assigned}
          </span>
          <span className="text-xs text-gray-400">/{required}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-2 text-xl font-bold" style={{ color: "#5a5a5a" }}>Staffing Requirements</h2>
      <p className="text-xs text-gray-400 mb-5">Assigned / Required for this day</p>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-xl border p-4" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
          <span className="font-medium text-sm" style={{ color: "#5a5a5a" }}>Dentists Working</span>
          <span className="font-bold text-lg" style={{ color: "#e8622a" }}>{dentistCount}</span>
        </div>

        <StatusRow
          label="Assistants"
          required={assistantsRequired}
          assigned={assistantsAssigned}
          short={assistantShort}
        />

        <StatusRow
          label="Front Desk"
          required={2}
          assigned={frontDeskAssigned}
          short={frontDeskShort}
        />

        <StatusRow
          label="Hygienist"
          required={1}
          assigned={hygienistsAssigned}
          short={hygienistShort}
        />
      </div>

      {(assistantShort || frontDeskShort || hygienistShort) && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-xs font-semibold text-red-600">
            🔴 This day needs temporary staff — contact your agency.
          </p>
        </div>
      )}
    </div>
  );
}
