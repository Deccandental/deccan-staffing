interface Props {
  dentistCount: number;
}

export default function DailyRequirements({
  dentistCount,
}: Props) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-6 text-2xl font-bold">
        Daily Requirements
      </h2>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <span>Dentists Scheduled</span>
          <span className="font-semibold">{dentistCount}</span>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <span>Front Desk Required</span>
          <span className="font-semibold">2</span>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <span>Assistants Required</span>
          <span className="font-semibold">{dentistCount}</span>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <span>Hygienists Required</span>
          <span className="font-semibold">1</span>
        </div>
      </div>
    </div>
  );
}