"use client";

import { DailyAssignments as DailyAssignmentsType } from "@/types/assignment";

interface Props {
  selectedDate: string;
  assignments?: DailyAssignmentsType;
}

const EMPTY: DailyAssignmentsType = { dentists: [], frontDesk: [], hygienists: [] };

export default function DailyAssignments({ selectedDate, assignments = EMPTY }: Props) {
  const dateLabel = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "Select a day";

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-1 text-2xl font-bold">Daily Assignments</h2>
      <p className="mb-6 text-slate-500">{dateLabel}</p>

      <div className="space-y-4">
        <section className="rounded-xl border p-4">
          <h3 className="mb-3 font-semibold">Dentist / Assistant Pairings</h3>
          {assignments.dentists.length === 0 ? (
            <p className="text-sm text-slate-400">No dentists selected.</p>
          ) : (
            <div className="space-y-2">
              {assignments.dentists.map(({ dentist, assistant }) => (
                <div key={dentist.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium">{dentist.name}</span>
                  <span className={assistant ? "text-slate-600" : "text-amber-500"}>
                    {assistant?.name ?? "No Assistant"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border p-4">
          <h3 className="mb-3 font-semibold">Front Desk</h3>
          {assignments.frontDesk.length === 0 ? (
            <p className="text-sm text-slate-400">None available</p>
          ) : assignments.frontDesk.map((e) => (
            <div key={e.id} className="text-sm py-1">{e.name}</div>
          ))}
        </section>

        <section className="rounded-xl border p-4">
          <h3 className="mb-3 font-semibold">Hygienist</h3>
          {assignments.hygienists.length === 0 ? (
            <p className="text-sm text-slate-400">None available</p>
          ) : assignments.hygienists.map((e) => (
            <div key={e.id} className="text-sm py-1">{e.name}</div>
          ))}
        </section>
      </div>
    </div>
  );
}
