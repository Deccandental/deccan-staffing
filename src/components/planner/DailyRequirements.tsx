"use client";

interface Props {
  dentistCount: number;
}

export default function DailyRequirements({
  dentistCount,
}: Props) {
  const assistantsRequired = dentistCount;
  const frontDeskRequired = 2;
  const hygienistsRequired = 1;

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-6 text-2xl font-bold">
        Staffing Requirements
      </h2>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border p-4">
          <span>Dentists Working</span>
          <span className="font-semibold">
            {dentistCount}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl border p-4">
          <span>Assistants Required</span>
          <span className="font-semibold">
            {assistantsRequired}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl border p-4">
          <span>Front Desk Required</span>
          <span className="font-semibold">
            {frontDeskRequired}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl border p-4">
          <span>Hygienists Required</span>
          <span className="font-semibold">
            {hygienistsRequired}
          </span>
        </div>
      </div>
    </div>
  );
}