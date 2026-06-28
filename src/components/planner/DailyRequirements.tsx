"use client";

interface Props {
  dentistsWorking: number;
}

export default function DailyRequirements({
  dentistsWorking,
}: Props) {
  const assistants = dentistsWorking;

  const frontDesk = 2;

  const hygienists = 1;

  return (
    <div className="rounded-2xl bg-white p-6 shadow">

      <h2 className="mb-5 text-2xl font-bold">
        Daily Requirements
      </h2>

      <div className="space-y-4">

        <div className="flex justify-between border-b pb-2">
          <span>Dentists</span>
          <span className="font-bold">
            {dentistsWorking}
          </span>
        </div>

        <div className="flex justify-between border-b pb-2">
          <span>Front Desk</span>
          <span className="font-bold">
            {frontDesk}
          </span>
        </div>

        <div className="flex justify-between border-b pb-2">
          <span>Assistants</span>
          <span className="font-bold">
            {assistants}
          </span>
        </div>

        <div className="flex justify-between">
          <span>Hygienist</span>
          <span className="font-bold">
            {hygienists}
          </span>
        </div>

      </div>

      <div className="mt-6 rounded-xl bg-green-100 p-3 text-center font-semibold text-green-700">
        Staffing Requirements Updated
      </div>

    </div>
  );
}