"use client";

import { employees } from "../data/employees";

interface DentistSelectorProps {
  selected: number[];
  onChange: (selected: number[]) => void;
}

export default function DentistSelector({
  selected,
  onChange,
}: DentistSelectorProps) {
  const dentists = employees.filter(
    (employee) => employee.role === "Dentist"
  );

  function toggle(id: number) {
    if (selected.includes(id)) {
      onChange(selected.filter((d) => d !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow p-6 mb-6">
      <h2 className="text-xl font-bold mb-4">
        Dentists Working Today
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {dentists.map((dentist) => {
          const active = selected.includes(dentist.id);

          return (
            <button
              key={dentist.id}
              onClick={() => toggle(dentist.id)}
              className={`rounded-xl border p-4 transition ${
                active
                  ? "bg-blue-600 text-white border-blue-600"
                  : "hover:bg-slate-100"
              }`}
            >
              {dentist.name}
            </button>
          );
        })}
      </div>

      <div className="mt-5 text-gray-600">
        Dentists Selected:
        <span className="font-bold ml-2">
          {selected.length}
        </span>
      </div>
    </div>
  );
}