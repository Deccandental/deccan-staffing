"use client";

interface Props {
  dentists: string[];
  selected: string[];
  onChange: (dentists: string[]) => void;
}

export default function DentistSelector({
  dentists,
  selected,
  onChange,
}: Props) {
  function toggle(name: string) {
    if (selected.includes(name)) {
      onChange(
        selected.filter((dentist) => dentist !== name)
      );
    } else {
      onChange([...selected, name]);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-2 text-2xl font-bold">
        Dentists Working
      </h2>

      <p className="mb-6 text-slate-500">
        Select which dentists are working on the currently selected day.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {dentists.map((dentist) => {
          const checked =
            selected.includes(dentist);

          return (
            <button
              key={dentist}
              type="button"
              onClick={() => toggle(dentist)}
              className={`rounded-xl border p-4 text-left transition ${
                checked
                  ? "border-blue-600 bg-blue-50"
                  : "hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {dentist}
                </span>

                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}