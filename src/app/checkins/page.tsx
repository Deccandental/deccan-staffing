"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import {
  CheckinSlot, loadAllSlots, createSlot, claimSlot, unclaimSlot,
  markSlotCompleted, updateSlotNotes, deleteSlot, computeCheckinStatus,
} from "@/lib/checkinsStore";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function generateTimeOptions(): string[] {
  const options: string[] = [];
  for (let minutes = 9 * 60; minutes <= 17 * 60; minutes += 10) {
    const h24 = Math.floor(minutes / 60);
    const m = minutes % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const ampm = h24 < 12 || h24 === 24 ? "AM" : "PM";
    options.push(`${h12}:${String(m).padStart(2, "0")} ${ampm}`);
  }
  return options;
}
const TIME_OPTIONS = generateTimeOptions();

function CheckinsPageBody({ identity }: { identity: AppIdentity }) {
  const [staff, setStaff] = useState<Employee[]>([]);
  const [slots, setSlots] = useState<CheckinSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSlotDate, setNewSlotDate] = useState(todayStr());
  const [newSlotTime, setNewSlotTime] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [claimingSlotId, setClaimingSlotId] = useState<string | null>(null);
  const [claimNotes, setClaimNotes] = useState("");
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});

  const today = todayStr();
  const isAdmin = !!identity.canAdmin;

  async function refresh() {
    setLoading(true);
    const [s, sl] = await Promise.all([loadStaff(), loadAllSlots()]);
    setStaff(s.filter((e) => !e.archived));
    setSlots(sl);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  const myStatus = identity.employeeId != null ? computeCheckinStatus(identity.employeeId, slots, today) : null;
  const openSlots = slots.filter((s) => !s.claimedByEmployeeId && s.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  async function handleCreateSlot() {
    if (!newSlotDate || !newSlotTime.trim()) return;
    const result = await createSlot(newSlotDate, newSlotTime.trim());
    if (!result.ok) { setCreateError(result.error ?? "Failed to create slot."); return; }
    setCreateError(null);
    setNewSlotTime("");
    await refresh();
  }

  async function handleClaim(slotId: string) {
    if (identity.employeeId == null || !identity.employeeName) return;
    await claimSlot(slotId, identity.employeeId, identity.employeeName, claimNotes);
    setClaimingSlotId(null);
    setClaimNotes("");
    await refresh();
  }

  async function handleToggleCompleted(slot: CheckinSlot) {
    await markSlotCompleted(slot.id, !slot.completed);
    await refresh();
  }

  async function handleSaveNotes(slotId: string) {
    const notes = notesDrafts[slotId];
    if (notes == null) return;
    await updateSlotNotes(slotId, notes);
    await refresh();
  }

  async function handleUnclaim(slotId: string) {
    if (!confirm("Unclaim this slot? It will become available again.")) return;
    await unclaimSlot(slotId);
    await refresh();
  }

  async function handleDelete(slotId: string) {
    if (!confirm("Delete this slot? This can't be undone.")) return;
    await deleteSlot(slotId);
    await refresh();
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">6-Month Check-Ins</h1>
          <p className="text-sm text-slate-500 mt-1">Regular one-on-ones with Dr. Nanjapa — required at least every six months, more often is fine.</p>
        </header>

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className="max-w-3xl space-y-4">
            {myStatus && (
              <div className="rounded-2xl bg-white shadow p-5">
                <h2 className="font-bold text-slate-700 mb-2">Your Status</h2>
                {myStatus.upcomingSlot ? (
                  <p className="text-sm text-blue-800">📅 You have a check-in scheduled for <strong>{fmtDate(myStatus.upcomingSlot.date)}</strong> at {myStatus.upcomingSlot.time}.</p>
                ) : myStatus.isDue ? (
                  <p className="text-sm font-semibold text-red-600">⚠️ You're due for a check-in{myStatus.lastCompletedDate ? ` — your last one was ${fmtDate(myStatus.lastCompletedDate)}` : " — you haven't had one yet"}. Pick a slot below.</p>
                ) : (
                  <p className="text-sm text-emerald-700">✓ Last check-in: {fmtDate(myStatus.lastCompletedDate!)}. Next one due by {fmtDate(myStatus.nextDueDate!)}.</p>
                )}
              </div>
            )}

            <div className="rounded-2xl bg-white shadow p-5">
              <h2 className="font-bold text-slate-700 mb-3">Available Slots</h2>
              {openSlots.length === 0 ? (
                <p className="text-sm text-slate-400">No open slots right now{isAdmin ? " — add some below." : " — check back soon, or ask Dr. Nanjapa to open some up."}</p>
              ) : (
                <div className="space-y-2">
                  {openSlots.map((slot) => (
                    <div key={slot.id} className="rounded-lg bg-slate-50 p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-sm font-semibold text-slate-700">{fmtDate(slot.date)} at {slot.time}</span>
                        {claimingSlotId === slot.id ? (
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleClaim(slot.id)} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Confirm</button>
                            <button onClick={() => { setClaimingSlotId(null); setClaimNotes(""); }} className="text-xs text-slate-400 hover:underline">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setClaimingSlotId(slot.id)} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Claim this slot</button>
                        )}
                      </div>
                      {claimingSlotId === slot.id && (
                        <textarea value={claimNotes} onChange={(e) => setClaimNotes(e.target.value)} placeholder="Anything you'd like to discuss? (optional)"
                          className="w-full mt-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" rows={2} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isAdmin && (
              <>
                <div className="rounded-2xl bg-white shadow p-5">
                  <h2 className="font-bold text-slate-700 mb-3">Create New Slots</h2>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-sm text-slate-800 font-semibold mb-1">Date</label>
                      <input type="date" value={newSlotDate} onChange={(e) => setNewSlotDate(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-800 font-semibold mb-1">Time</label>
                      <select value={newSlotTime} onChange={(e) => setNewSlotTime(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
                        <option value="">Select…</option>
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button onClick={handleCreateSlot} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition w-full" style={{ backgroundColor: "#e8622a" }}>Add Slot</button>
                    </div>
                  </div>
                  {createError && <p className="text-sm text-red-600 font-semibold mt-2">⚠️ {createError}</p>}
                </div>

                <div className="rounded-2xl bg-white shadow p-5">
                  <h2 className="font-bold text-slate-700 mb-3">Everyone — Due Status</h2>
                  <div className="space-y-1">
                    {staff.map((emp) => {
                      const status = computeCheckinStatus(emp.id, slots, today);
                      return (
                        <div key={emp.id} className="flex items-center justify-between text-sm rounded-lg px-3 py-2" style={{ background: status.isDue && !status.upcomingSlot ? "#fee2e2" : status.upcomingSlot ? "#dbeafe" : "#f0fdf4" }}>
                          <span className="font-semibold text-slate-700">{emp.name}</span>
                          <span className="text-xs" style={{ color: status.isDue && !status.upcomingSlot ? "#991b1b" : status.upcomingSlot ? "#1e3a8a" : "#065f46" }}>
                            {status.upcomingSlot
                              ? `Scheduled ${fmtDate(status.upcomingSlot.date)}`
                              : status.isDue
                                ? (status.lastCompletedDate ? `⚠️ Due — last: ${fmtDate(status.lastCompletedDate)}` : "⚠️ Never had one")
                                : `✓ Last: ${fmtDate(status.lastCompletedDate!)} — next due ${fmtDate(status.nextDueDate!)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl bg-white shadow p-5">
                  <h2 className="font-bold text-slate-700 mb-3">All Slots</h2>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {slots.length === 0 ? <p className="text-sm text-slate-400">No slots created yet.</p> : slots.map((slot) => (
                      <div key={slot.id} className="rounded-lg bg-slate-50 p-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <span className="text-sm font-semibold text-slate-700">{fmtDate(slot.date)} at {slot.time}</span>
                            {slot.claimedByName && <span className="text-xs text-slate-500 ml-2">— {slot.claimedByName}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {slot.claimedByEmployeeId ? (
                              <>
                                <label className="flex items-center gap-1 text-xs text-slate-600">
                                  <input type="checkbox" checked={slot.completed} onChange={() => handleToggleCompleted(slot)} />
                                  Completed
                                </label>
                                <button onClick={() => handleUnclaim(slot.id)} className="text-xs text-amber-600 hover:underline">Unclaim</button>
                              </>
                            ) : (
                              <button onClick={() => handleDelete(slot.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <input type="text" value={notesDrafts[slot.id] ?? slot.notes} onChange={(e) => setNotesDrafts((f) => ({ ...f, [slot.id]: e.target.value }))}
                            placeholder="Notes — what to discuss / what was discussed" className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                          <button onClick={() => handleSaveNotes(slot.id)} className="text-xs font-semibold text-orange-500 hover:underline whitespace-nowrap">Save</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function CheckinsPage() {
  return (
    <AppIdentityGate>
      {(identity) => <CheckinsPageBody identity={identity} />}
    </AppIdentityGate>
  );
}
