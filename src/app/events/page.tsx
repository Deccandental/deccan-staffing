"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import PasscodeGate from "@/components/PasscodeGate";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import {
  StaffEvent, NewEventInput, loadUpcomingEvents, createEvent, updateEvent, deleteEvent,
} from "@/lib/eventsStore";

const EMPTY_FORM: NewEventInput = {
  date: "", time: "", endTime: "", title: "", description: "",
  mandatory: false, inviteAll: true, invitedStaffIds: [],
  remind1Day: true, remind1Week: true, remind3Weeks: false,
};

function EventsPageBody() {
  const [staff, setStaff] = useState<Employee[]>([]);
  const [events, setEvents] = useState<StaffEvent[]>([]);
  const [form, setForm] = useState<NewEventInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [announceNow, setAnnounceNow] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const todayStr = new Date().toISOString().split("T")[0];
    const [s, e] = await Promise.all([loadStaff(), loadUpcomingEvents(todayStr)]);
    setStaff(s);
    setEvents(e);
  }

  function toggleInvitee(id: number) {
    setForm((f) => ({
      ...f,
      invitedStaffIds: f.invitedStaffIds.includes(id)
        ? f.invitedStaffIds.filter((i) => i !== id)
        : [...f.invitedStaffIds, id],
    }));
  }

  function startEdit(ev: StaffEvent) {
    setForm({
      date: ev.date, time: ev.time, endTime: ev.endTime, title: ev.title, description: ev.description,
      mandatory: ev.mandatory, inviteAll: ev.inviteAll, invitedStaffIds: ev.invitedStaffIds,
      remind1Day: ev.remind1Day, remind1Week: ev.remind1Week, remind3Weeks: ev.remind3Weeks,
    });
    setEditingId(ev.id);
    setAnnounceNow(false);
    setError("");
    setShowForm(true);
  }

  function closeForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setAnnounceNow(false);
    setError("");
    setShowForm(false);
  }

  async function handleSave() {
    setError("");
    if (!form.date) { setError("Please select a date."); return; }
    if (!form.title.trim()) { setError("Please enter a title."); return; }
    if (!form.inviteAll && form.invitedStaffIds.length === 0) { setError("Select at least one staff member, or invite everyone."); return; }

    setSaving(true);
    const cleaned = { ...form, title: form.title.trim(), description: form.description.trim() };
    const saved = editingId ? await updateEvent(editingId, cleaned) : await createEvent(cleaned);
    if (!saved) {
      setError("Something went wrong saving this event — it was not saved. Check the browser console for details, or try again.");
      setSaving(false);
      return;
    }
    if (announceNow) {
      try {
        await fetch("/api/events/notify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: saved.id }),
        });
      } catch {}
    }
    setSaving(false);
    closeForm();
    await refresh();
  }

  async function handleDelete(id: string) {
    await deleteEvent(id);
    await refresh();
  }

  function reminderSummary(ev: StaffEvent): string {
    const parts: string[] = [];
    if (ev.remind1Day) parts.push("1 day");
    if (ev.remind1Week) parts.push("1 week");
    if (ev.remind3Weeks) parts.push("3 weeks");
    return parts.length > 0 ? `Reminders: ${parts.join(", ")} before` : "No reminders";
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-8 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">Events</h1>
            <p className="mt-1 text-slate-500">Staff meetings, trainings, and announcements — with automatic reminders.</p>
          </div>
          <button onClick={() => { if (showForm) { closeForm(); } else { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); } }}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow hover:opacity-90 transition"
            style={{ backgroundColor: "#e8622a" }}>
            {showForm ? "✕ Cancel" : "+ New Event"}
          </button>
        </header>

        {showForm && (
          <div className="mb-6 rounded-2xl bg-white p-6 shadow max-w-2xl">
            <h2 className="text-lg font-bold mb-4">{editingId ? "Edit Event" : "New Event"}</h2>
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

            <div className="grid gap-4 sm:grid-cols-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Date</label>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-orange-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Start time (optional)</label>
                <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-orange-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">End time (optional)</label>
                <input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-orange-400" />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Title</label>
              <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Staff Meeting, CPR Training"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-orange-400" />
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Details (optional)</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2} placeholder="Location, agenda, anything staff should know"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-orange-400" />
            </div>

            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={form.mandatory} onChange={(e) => setForm((f) => ({ ...f, mandatory: e.target.checked }))} />
              <span className="text-sm font-medium text-slate-700">Mandatory attendance</span>
            </label>

            <div className="mb-4 rounded-xl border border-slate-200 p-4">
              <label className="flex items-center gap-2 mb-3 cursor-pointer">
                <input type="checkbox" checked={form.inviteAll} onChange={(e) => setForm((f) => ({ ...f, inviteAll: e.target.checked }))} />
                <span className="text-sm font-medium text-slate-700">Invite all staff</span>
              </label>
              {!form.inviteAll && (
                <div className="grid gap-1.5 sm:grid-cols-2 max-h-48 overflow-y-auto">
                  {staff.map((emp) => (
                    <label key={emp.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={form.invitedStaffIds.includes(emp.id)} onChange={() => toggleInvitee(emp.id)} />
                      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: emp.color }} />
                      <span className="text-sm">{emp.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-500 mb-2">Automatic reminders</p>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.remind1Day} onChange={(e) => setForm((f) => ({ ...f, remind1Day: e.target.checked }))} />
                  <span className="text-sm text-slate-600">1 day before</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.remind1Week} onChange={(e) => setForm((f) => ({ ...f, remind1Week: e.target.checked }))} />
                  <span className="text-sm text-slate-600">1 week before</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.remind3Weeks} onChange={(e) => setForm((f) => ({ ...f, remind3Weeks: e.target.checked }))} />
                  <span className="text-sm text-slate-600">3 weeks before</span>
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2 mb-5 cursor-pointer rounded-xl bg-orange-50 border border-orange-100 px-3 py-2.5">
              <input type="checkbox" checked={announceNow} onChange={(e) => setAnnounceNow(e.target.checked)} />
              <span className="text-sm font-medium text-orange-700">📣 {editingId ? "Send an announcement email about this update" : "Also send an announcement email right now"}</span>
            </label>

            <button onClick={handleSave} disabled={saving}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50"
              style={{ backgroundColor: "#e8622a" }}>
              {saving ? "Saving…" : editingId ? "Save Changes" : "Create Event"}
            </button>
          </div>
        )}

        <div className="space-y-3 max-w-2xl">
          {events.length === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow">
              <p className="text-slate-400">No upcoming events.</p>
            </div>
          ) : (
            events.map((ev) => {
              const dateLabel = new Date(ev.date + "T00:00:00").toLocaleDateString("en-US", {
                weekday: "long", month: "long", day: "numeric",
