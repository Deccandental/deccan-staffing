"use client";

import { useState, useEffect, useMemo } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import AccessDenied from "@/components/AccessDenied";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import { byLastName } from "@/lib/format";
import { CheckinSlot, loadAllSlots } from "@/lib/checkinsStore";
import {
  StaffNote, StaffNoteKind, NOTE_KIND_LABELS,
  loadStaffNotes, addStaffNote, updateStaffNote, deleteStaffNote, setFollowUpDone, dueFollowUps,
} from "@/lib/staffNotes";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(s: string): string {
  return new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const KIND_STYLES: Record<StaffNoteKind, { bg: string; color: string }> = {
  checkin: { bg: "#E6F1FB", color: "#185FA5" },
  extra: { bg: "#EDE9FB", color: "#4A3C9E" },
  review: { bg: "#EAF3DE", color: "#3B6D11" },
  incident: { bg: "#FAEEDA", color: "#854F0B" },
  general: { bg: "#F1F0EE", color: "rgba(74,66,56,0.7)" },
};

const EMPTY_FORM = {
  noteDate: todayStr(),
  kind: "extra" as StaffNoteKind,
  sharedNote: "",
  privateNote: "",
  followUpDate: "",
  checkinSlotId: "",
};

function StaffNotesBody({ identity }: { identity: AppIdentity }) {
  const [staff, setStaff] = useState<Employee[]>([]);
  const [notes, setNotes] = useState<StaffNote[]>([]);
  const [slots, setSlots] = useState<CheckinSlot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const [s, n, sl] = await Promise.all([loadStaff(), loadStaffNotes(), loadAllSlots()]);
    setStaff([...s].filter((e) => !e.archived).sort(byLastName));
    setNotes(n);
    setSlots(sl);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  const today = todayStr();
  const selected = staff.find((e) => e.id === selectedId) ?? null;
  const personNotes = useMemo(
    () => notes.filter((n) => n.employeeId === selectedId).sort((a, b) => b.noteDate.localeCompare(a.noteDate)),
    [notes, selectedId]
  );
  const due = useMemo(() => dueFollowUps(notes, today), [notes, today]);

  // Completed check-ins for this person that don't yet have a note, so a
  // conversation can be written up straight from the slot it happened in.
  const notedSlotIds = new Set(notes.map((n) => n.checkinSlotId).filter(Boolean));
  const openCheckins = selectedId == null ? [] : slots
    .filter((s) => s.claimedByEmployeeId === selectedId && s.completed && !notedSlotIds.has(s.id))
    .sort((a, b) => b.date.localeCompare(a.date));

  function startAdd(prefill?: Partial<typeof EMPTY_FORM>) {
    setForm({ ...EMPTY_FORM, noteDate: todayStr(), ...prefill });
    setEditingId(null);
    setError("");
    setShowForm(true);
  }

  function startEdit(n: StaffNote) {
    setForm({
      noteDate: n.noteDate, kind: n.kind, sharedNote: n.sharedNote,
      privateNote: n.privateNote, followUpDate: n.followUpDate ?? "",
      checkinSlotId: n.checkinSlotId ?? "",
    });
    setEditingId(n.id);
    setError("");
    setShowForm(true);
  }

  async function handleSave() {
    if (selectedId == null) { setError("Pick a staff member first."); return; }
    if (!form.sharedNote.trim() && !form.privateNote.trim()) {
      setError("Write something in at least one of the two notes.");
      return;
    }
    setSaving(true);
    const result = editingId
      ? await updateStaffNote(editingId, {
          noteDate: form.noteDate, kind: form.kind,
          sharedNote: form.sharedNote.trim(), privateNote: form.privateNote.trim(),
          followUpDate: form.followUpDate || null,
        })
      : await addStaffNote({
          employeeId: selectedId, noteDate: form.noteDate, kind: form.kind,
          sharedNote: form.sharedNote.trim(), privateNote: form.privateNote.trim(),
          followUpDate: form.followUpDate || null,
          checkinSlotId: form.checkinSlotId || null,
          recordedBy: identity.employeeName ?? "Admin",
        });
    setSaving(false);
    if (!result.ok) { setError(result.error ?? "Couldn't save."); return; }
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    await refresh();
  }

  const input = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none";

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">Staff Notes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Notes from check-ins, performance reviews and incident reviews. Each entry has a shared note the person can read on their own dashboard, and a private note only managers see.
          </p>
        </header>

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className="max-w-5xl space-y-4">

            {/* Follow-ups first — the reason for recording a date is that a
                "let's revisit this" doesn't quietly disappear. */}
            {due.length > 0 && (
              <div className="rounded-2xl p-4" style={{ background: "#FAEEDA" }}>
                <p className="text-sm font-semibold mb-2" style={{ color: "#854F0B" }}>
                  {due.length} follow-up{due.length === 1 ? "" : "s"} due
                </p>
                <div className="space-y-1">
                  {due.map((n) => {
                    const who = staff.find((e) => e.id === n.employeeId)?.name ?? "Unknown";
                    return (
                      <div key={n.id} className="flex items-center justify-between gap-3 text-xs bg-white rounded-lg px-3 py-2">
                        <span style={{ color: "#4A4238" }}>
                          <button onClick={() => setSelectedId(n.employeeId)} className="font-semibold hover:underline">{who}</button>
                          {" — "}{NOTE_KIND_LABELS[n.kind]} on {fmtDate(n.noteDate)}
                          <span style={{ color: "#854F0B" }}> · due {fmtDate(n.followUpDate!)}</span>
                        </span>
                        <button onClick={async () => { await setFollowUpDone(n.id, true); refresh(); }}
                          className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
                          style={{ backgroundColor: "#0F6E56" }}>Done</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              {/* Everyone, with their most recent note so the list itself
                  shows who hasn't been spoken to in a while. */}
              <div className="rounded-2xl bg-white shadow p-3">
                <h2 className="font-bold text-slate-700 text-sm px-1 mb-2">Staff</h2>
                <div className="space-y-0.5">
                  {staff.map((e) => {
                    const last = notes.filter((n) => n.employeeId === e.id).sort((a, b) => b.noteDate.localeCompare(a.noteDate))[0];
                    const active = e.id === selectedId;
                    return (
                      <button key={e.id} onClick={() => { setSelectedId(e.id); setShowForm(false); }}
                        className="w-full text-left rounded-lg px-3 py-2 transition hover:bg-slate-50"
                        style={active ? { background: "#FAECE7" } : undefined}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                          <span className="text-sm font-medium" style={{ color: "#4A4238" }}>{e.name}</span>
                        </span>
                        <span className="block text-xs mt-0.5 pl-4" style={{ color: last ? "rgba(74,66,56,0.5)" : "#A32D2D" }}>
                          {last ? `Last note ${fmtDate(last.noteDate)}` : "No notes yet"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-2 space-y-4">
                {!selected ? (
                  <div className="rounded-2xl bg-white shadow p-6">
                    <p className="text-sm text-slate-400">Pick someone to see their notes.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl bg-white shadow p-5">
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                        <h2 className="font-bold text-slate-700">{selected.name}</h2>
                        {!showForm && (
                          <button onClick={() => startAdd()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>
                            + Add Note
                          </button>
                        )}
                      </div>

                      {openCheckins.length > 0 && !showForm && (
                        <div className="mt-2 rounded-xl px-3 py-2" style={{ background: "#E6F1FB" }}>
                          <p className="text-xs font-semibold mb-1" style={{ color: "#185FA5" }}>Completed check-ins with no note yet</p>
                          {openCheckins.slice(0, 3).map((s) => (
                            <div key={s.id} className="flex items-center justify-between gap-2 text-xs py-0.5">
                              <span style={{ color: "#185FA5" }}>
                                {fmtDate(s.date)} at {s.time}
                                {s.notes && <span className="opacity-70"> · they wrote: &ldquo;{s.notes}&rdquo;</span>}
                              </span>
                              <button onClick={() => startAdd({ kind: "checkin", noteDate: s.date, checkinSlotId: s.id })}
                                className="flex-shrink-0 font-semibold hover:underline" style={{ color: "#185FA5" }}>
                                Write it up →
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {showForm && (
                        <div className="mt-3 rounded-xl border border-slate-200 p-4 space-y-3">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Date</label>
                              <input type="date" value={form.noteDate} onChange={(e) => setForm((f) => ({ ...f, noteDate: e.target.value }))} className={input} />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Type</label>
                              <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as StaffNoteKind }))} className={`${input} bg-white`}>
                                {(Object.keys(NOTE_KIND_LABELS) as StaffNoteKind[]).map((k) => (
                                  <option key={k} value={k}>{NOTE_KIND_LABELS[k]}</option>
                                ))}
                              </select>
                              {(form.kind === "checkin" || form.kind === "extra") && (
                                <p className="text-xs text-slate-400 mt-1">
                                  {form.kind === "checkin"
                                    ? "One of the regular cycle — every 6 months."
                                    : "An extra conversation in between the scheduled ones."}
                                </p>
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Follow up by (optional)</label>
                              <input type="date" value={form.followUpDate} onChange={(e) => setForm((f) => ({ ...f, followUpDate: e.target.value }))} className={input} />
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">
                              Shared note <span className="font-normal text-slate-400">— {selected.name} can read this on their dashboard</span>
                            </label>
                            <textarea value={form.sharedNote} onChange={(e) => setForm((f) => ({ ...f, sharedNote: e.target.value }))} rows={3}
                              placeholder="What was discussed, and anything agreed." className={`${input} resize-none`} />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">
                              Private note <span className="font-normal text-slate-400">— managers only</span>
                            </label>
                            <textarea value={form.privateNote} onChange={(e) => setForm((f) => ({ ...f, privateNote: e.target.value }))} rows={3}
                              className={`${input} resize-none`} style={{ background: "#FBF7F1" }} />
                          </div>

                          {error && <p className="text-xs font-semibold text-red-600">⚠️ {error}</p>}
                          <div className="flex items-center gap-2">
                            <button onClick={handleSave} disabled={saving}
                              className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
                              {saving ? "Saving…" : editingId ? "Save changes" : "Save note"}
                            </button>
                            <button onClick={() => { setShowForm(false); setEditingId(null); setError(""); }} className="text-sm text-slate-400 hover:underline">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl bg-white shadow p-5">
                      <h3 className="font-bold text-slate-700 text-sm mb-3">History</h3>
                      {personNotes.length === 0 ? (
                        <p className="text-sm text-slate-400">Nothing recorded for {selected.name} yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {personNotes.map((n) => {
                            const style = KIND_STYLES[n.kind];
                            return (
                              <div key={n.id} className="rounded-xl border border-slate-100 p-3">
                                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                                  <span className="flex items-center gap-2">
                                    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: style.bg, color: style.color }}>
                                      {NOTE_KIND_LABELS[n.kind]}
                                    </span>
                                    <span className="text-sm font-medium" style={{ color: "#4A4238" }}>{fmtDate(n.noteDate)}</span>
                                    {n.recordedBy && <span className="text-xs text-slate-400">by {n.recordedBy}</span>}
                                  </span>
                                  <span className="flex items-center gap-2 text-xs">
                                    <button onClick={() => startEdit(n)} className="text-orange-500 hover:underline">Edit</button>
                                    <button onClick={async () => {
                                      if (!confirm("Delete this note? This can't be undone.")) return;
                                      await deleteStaffNote(n.id); refresh();
                                    }} className="text-red-400 hover:underline">Delete</button>
                                  </span>
                                </div>

                                {n.sharedNote && (
                                  <div className="mb-2">
                                    <p className="text-xs font-semibold mb-0.5" style={{ color: "rgba(74,66,56,0.45)" }}>Shared with {selected.name}</p>
                                    <p className="text-sm whitespace-pre-wrap" style={{ color: "#4A4238" }}>{n.sharedNote}</p>
                                  </div>
                                )}
                                {n.privateNote && (
                                  <div className="rounded-lg px-3 py-2" style={{ background: "#FBF7F1" }}>
                                    <p className="text-xs font-semibold mb-0.5" style={{ color: "rgba(74,66,56,0.45)" }}>🔒 Private</p>
                                    <p className="text-sm whitespace-pre-wrap" style={{ color: "#4A4238" }}>{n.privateNote}</p>
                                  </div>
                                )}

                                {n.followUpDate && (
                                  <p className="text-xs mt-2" style={{ color: n.followUpDone ? "rgba(74,66,56,0.4)" : "#854F0B" }}>
                                    {n.followUpDone ? "✓ Followed up" : `Follow up by ${fmtDate(n.followUpDate)}`}
                                    {!n.followUpDone && (
                                      <button onClick={async () => { await setFollowUpDone(n.id, true); refresh(); }} className="ml-2 font-semibold hover:underline">Mark done</button>
                                    )}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function StaffNotesPage() {
  return (
    <AppIdentityGate>
      {(identity, logout) =>
        identity.canManageStaffNotes || identity.mode === "super"
          ? <StaffNotesBody identity={identity} />
          : <AccessDenied logout={logout} />
      }
    </AppIdentityGate>
  );
}
