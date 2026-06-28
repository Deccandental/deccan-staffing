"use client";

interface Props {
  selectedDentists: string[];
  setSelectedDentists: (dentists: string[]) => void;
}

const dentists = [
  "Dr. Nanjapa",
  "Dr. Coulter",
  "Dr. Viraparia",
  "Dr. Ho",
];

export default function DentistSelector({
  selectedDentists,
  setSelectedDentists,
}: Props) {

  function toggleDentist(name: string) {

    if (selectedDentists.includes(name)) {

      setSelectedDentists(
        selectedDentists.filter((d) => d !== name)
      );

    } else {

      setSelectedDentists([
        ...selectedDentists,
        name,
      ]);

    }

  }

  return (

    <div className="rounded-2xl bg-white p-6 shadow">

      <h2 className="mb-5 text-2xl font-bold">
        Dentists Working Today
      </h2>

      <div className="space-y-3">

        {dentists.map((dentist) => {

          const selected =
            selectedDentists.includes(dentist);

          return (

            <button
              key={dentist}
              onClick={() => toggleDentist(dentist)}
              className={`flex w-full items-center justify-between rounded-xl border p-4 transition ${
                selected
                  ? "border-blue-600 bg-blue-50"
                  : "hover:bg-slate-50"
              }`}
            >

              <span>{dentist}</span>

              <span className="text-xl">
                {selected ? "✓" : ""}
              </span>

            </button>

          );

        })}

      </div>

      <div className="mt-6 rounded-xl bg-slate-100 p-4">

        <div className="text-sm text-slate-600">
          Dentists Scheduled
        </div>

        <div className="text-4xl font-bold">
          {selectedDentists.length}
        </div>

      </div>

    </div>

  );

}