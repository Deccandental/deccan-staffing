interface Props {
  dentistCount: number;
}

export default function DailyRequirements({
  dentistCount,
}: Props) {
  const assistants = dentistCount;
  const frontDesk = 2;
  const hygienists = 1;

  return (
    <div className="bg-white rounded-2xl shadow p-6 mb-6">

      <h2 className="text-xl font-bold mb-4">
        Staffing Requirements
      </h2>

      <div className="grid grid-cols-4 gap-4">

        <div className="rounded-xl bg-blue-50 p-4">
          <div className="text-sm text-gray-500">
            Dentists
          </div>
          <div className="text-3xl font-bold">
            {dentistCount}
          </div>
        </div>

        <div className="rounded-xl bg-green-50 p-4">
          <div className="text-sm text-gray-500">
            Front Desk
          </div>
          <div className="text-3xl font-bold">
            {frontDesk}
          </div>
        </div>

        <div className="rounded-xl bg-yellow-50 p-4">
          <div className="text-sm text-gray-500">
            Assistants
          </div>
          <div className="text-3xl font-bold">
            {assistants}
          </div>
        </div>

        <div className="rounded-xl bg-purple-50 p-4">
          <div className="text-sm text-gray-500">
            Hygienists
          </div>
          <div className="text-3xl font-bold">
            {hygienists}
          </div>
        </div>

      </div>

    </div>
  );
}