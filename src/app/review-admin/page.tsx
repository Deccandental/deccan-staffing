"use client";

import { useState, useEffect, useCallback } from "react";
import type { DragEvent } from "react";
import AppIdentityGate from "@/components/AppIdentityGate";
import { Sidebar } from "@/components/Sidebar";
import { supabase } from "@/lib/supabase";
import { loadStaff } from "@/lib/staffStore";
import { getSessionToken } from "@/lib/secureData";
import { Employee } from "@/types/employee";

/**
 * Send a document to staff to review, and see who has reviewed it. Admins only.
 * Each person logs in with their PIN, opens the document and confirms with their initials.
 */

interface Doc { id: string; title: string; note: string; due_date: string | null; file_name: string; created_by: string; created_at: string }
interface Assign { id: string; doc_id: string; employee_id: number; employee_name: string; opened_at: string | null; reviewed_at: string | null; initials: string | null }

async function api(body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch("/api/reviews/admin", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Couldn't reach the server." } }; }
}
const fmt = (d: string) => new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function PeoplePicker({ staff, chosen, setChosen, skip }: { staff: Employee[]; chosen: number[]; setChosen: (ids: number[]) => void; skip?: number[] }) {
  const list = staff.filter((e) => !e.archived && !(skip ?? []).includes(e.id));
  const toggle = (id: number) => setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  return (
    <div>
      <div className="flex items-center gap-3 mb-1.5 text-xs">
        <button onClick={() => setChosen(list.map((e) => e.id))} className="font-semibold text-orange-500 hover:underline">Select everyone</button>
        <button onClick={() => setChosen([])} className="text-slate-400 hover:underline">Clear</button>
        <span className="text-slate-400">{chosen.length} chosen</span>
      </div>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((e) => (
          <label key={e.id} className="flex items-center gap-2 text-sm text-slate-700 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 cursor-pointer">
            <input type="checkbox" checked={chosen.includes(e.id)} onChange={() => toggle(e.id)} />
            <span className="truncate">{e.name}</span>
            {!e.email && <span className="text-[10px] text-amber-600" title="No email address on file, so no email can be sent">no email</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

function AdminBody() {
  const [staff, setStaff] = useState<Employee[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [assigns, setAssigns] = useState<Assign[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  // the form
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [dragging, setDragging] = useState(false);
  // existing documents
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [addChosen, setAddChosen] = useState<number[]>([]);

  useEffect(() => { loadStaff().then(setStaff); }, []);
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", stop); window.addEventListener("drop", stop);
    return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); };
  }, []);

  const load = useCallback(async () => {
    const r = await api({ action: "list" });
    if (!r.ok) { setError(r.json.error ?? "Couldn't load the documents."); return; }
    setError(""); setDocs(r.json.docs ?? []); setAssigns(r.json.assignments ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  function pick(f: File | null) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) { setMsg("Only PDF files can be sent."); return; }
    setFile(f); if (!title.trim()) setTitle(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
  }
  function onDrop(e: DragEvent<HTMLElement>) { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0] ?? null); }

  async function send() {
    setMsg("");
    if (!file) { setMsg("Drop or choose the PDF first."); return; }
    if (!title.trim()) { setMsg("Give the document a title."); return; }
    if (chosen.length === 0) { setMsg("Choose at least one person to review it."); return; }
    setBusy("send");
    const slot = await api({ action: "upload-url", fileName: file.name, size: file.size });
    if (!slot.ok) { setBusy(""); setMsg(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("statements").uploadToSignedUrl(slot.json.path, slot.json.token, file, { contentType: "application/pdf" });
    if (up.error) { setBusy(""); setMsg(`Upload failed: ${up.error.message}`); return; }
    const r = await api({ action: "create", docId: slot.json.docId, path: slot.json.path, fileName: file.name, size: file.size, title, note, dueDate: due, employeeIds: chosen });
    setBusy("");
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't send the document."); return; }
    setMsg(`Sent to ${r.json.people} ${r.json.people === 1 ? "person" : "people"}${r.json.emailed ? `, ${r.json.emailed} emailed` : ""}.${r.json.noEmail?.length ? ` No email on file for: ${r.json.noEmail.join(", ")}.` : ""}${r.json.failed ? " The emails couldn't be sent." : ""}`);
    setFile(null); setTitle(""); setNote(""); setDue(""); setChosen([]); load();
  }

  async function view(d: Doc) {
    const w = window.open("", "_blank");
    const r = await api({ action: "download", docId: d.id });
    if (!r.ok) { if (w) w.close(); setMsg(r.json.error ?? "Couldn't open the document."); return; }
    if (w) w.location.href = r.json.url;
  }
  async function remind(d: Doc) {
    if (!window.confirm(`Email a reminder to everyone who hasn't reviewed "${d.title}"?`)) return;
    setBusy(`rem:${d.id}`);
    const r = await api({ action: "remind", docId: d.id });
    setBusy("");
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't send reminders."); return; }
    setMsg(`Reminder sent to ${r.json.reminded} ${r.json.reminded === 1 ? "person" : "people"}.${r.json.noEmail?.length ? ` No email on file for: ${r.json.noEmail.join(", ")}.` : ""}${r.json.failed ? " The emails couldn't be sent." : ""}`);
    load();
  }
  async function addPeople(d: Doc) {
    setBusy(`add:${d.id}`);
    const r = await api({ action: "addPeople", docId: d.id, employeeIds: addChosen });
    setBusy("");
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't add them."); return; }
    setMsg(`Added ${r.json.people} ${r.json.people === 1 ? "person" : "people"}${r.json.emailed ? `, ${r.json.emailed} emailed` : ""}.`);
    setAdding(null); setAddChosen([]); load();
  }
  async function removePerson(a: Assign) {
    if (!window.confirm(`Remove ${a.employee_name} from this document?`)) return;
    const r = await api({ action: "removePerson", assignmentId: a.id });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't remove."); return; }
    load();
  }
  async function removeDoc(d: Doc) {
    if (!window.confirm(`Delete "${d.title}"? The file and everyone's review records are removed. This can't be undone.`)) return;
    const r = await api({ action: "remove", docId: d.id });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't delete."); return; }
    setOpen(null); load();
  }
  async function changeDue(d: Doc, value: string) {
    const r = await api({ action: "setDue", docId: d.id, dueDate: value });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't change the date."); return; }
    load();
  }

  const today = new Date().toISOString().slice(0, 10);
  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <div className="max-w-4xl space-y-4">
          <div>
            <h1 className="text-2xl font-bold">Send for review</h1>
            <p className="text-sm text-slate-500">Send a PDF to staff. Each person opens it with their PIN and confirms with their initials.</p>
          </div>
          {error && <p className="text-sm font-semibold text-red-600">⚠️ {error}</p>}
          {msg && <p className="text-sm font-semibold text-slate-700">{msg}</p>}

          <div className="rounded-2xl bg-white shadow px-5 py-4 space-y-3" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDrop={onDrop}
            style={{ outline: dragging ? "2px dashed #e8622a" : "none", background: dragging ? "#fff7ed" : undefined }}>
            <h2 className="font-bold text-slate-800">Send a document</h2>
            <div className="flex flex-wrap items-center gap-3">
              <label className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 cursor-pointer hover:bg-slate-50">
                Choose PDF
                <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; pick(f); }} />
              </label>
              <span className="text-sm text-slate-500">{file ? <>📄 <strong className="text-slate-700">{file.name}</strong> <button onClick={() => setFile(null)} className="ml-1 text-slate-400 hover:text-slate-600">✕</button></> : "or drag the PDF anywhere on this card"}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2"><label className="block text-xs font-semibold text-slate-500 mb-1">Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" /></div>
              <div><label className="block text-xs font-semibold text-slate-500 mb-1">Review by (optional)</label>
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" /></div>
              <div className="sm:col-span-3"><label className="block text-xs font-semibold text-slate-500 mb-1">Note to staff (optional)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" placeholder="What they should look for, or why you're sending it" /></div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Who needs to review it?</label>
              <PeoplePicker staff={staff} chosen={chosen} setChosen={setChosen} />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={send} disabled={busy === "send"} className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>{busy === "send" ? "Sending…" : "Send for review"}</button>
              <span className="text-xs text-slate-400">Each person gets their own email.</span>
            </div>
          </div>

          <h2 className="font-bold text-slate-700 pt-2">Sent documents</h2>
          {docs.length === 0 && <p className="text-sm text-slate-400">Nothing sent yet.</p>}
          {docs.map((d) => {
            const mine = assigns.filter((a) => a.doc_id === d.id);
            const reviewed = mine.filter((a) => a.reviewed_at).length;
            const overdue = !!d.due_date && d.due_date < today && reviewed < mine.length;
            const isOpen = open === d.id;
            return (
              <div key={d.id} className="rounded-2xl bg-white shadow px-5 py-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button onClick={() => setOpen(isOpen ? null : d.id)} className="text-left">
                    <span className="font-bold text-slate-800">{d.title}</span>
                    <span className="block text-xs text-slate-400">Sent {fmt(d.created_at)} by {d.created_by}{d.due_date ? ` · review by ${fmt(d.due_date)}` : ""}</span>
                  </button>
                  <div className="flex items-center gap-2">
                    {overdue && <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "#fee2e2", color: "#991b1b" }}>Past due</span>}
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: reviewed === mine.length && mine.length > 0 ? "#e7f6ec" : "#fef3c7", color: reviewed === mine.length && mine.length > 0 ? "#166534" : "#92400e" }}>{reviewed} of {mine.length} reviewed</span>
                    <button onClick={() => setOpen(isOpen ? null : d.id)} className="text-xs text-slate-500 hover:underline">{isOpen ? "Hide" : "Details"}</button>
                  </div>
                </div>
                {isOpen && (
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    {d.note && <p className="text-sm text-slate-600 whitespace-pre-line">{d.note}</p>}
                    <div>
                      {mine.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 py-1 text-sm border-t border-slate-50 first:border-0">
                          <span className="w-44 truncate text-slate-700">{a.employee_name}</span>
                          {a.reviewed_at ? <span className="text-xs font-semibold" style={{ color: "#166534" }}>✓ Reviewed {fmt(a.reviewed_at)} · {a.initials}</span>
                            : a.opened_at ? <span className="text-xs" style={{ color: "#92400e" }}>Opened {fmt(a.opened_at)}, not confirmed yet</span>
                            : <span className="text-xs text-slate-400">Not opened</span>}
                          <button onClick={() => removePerson(a)} className="ml-auto text-xs text-red-400 hover:text-red-600 hover:underline">Remove</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button onClick={() => view(d)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: "#0f766e" }}>View document</button>
                      <button onClick={() => remind(d)} disabled={reviewed === mine.length || busy === `rem:${d.id}`} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: "#e8622a" }}>{busy === `rem:${d.id}` ? "Sending…" : "Remind those who haven't"}</button>
                      <button onClick={() => { setAdding(adding === d.id ? null : d.id); setAddChosen([]); }} className="text-xs font-semibold text-orange-500 hover:underline">+ Add people</button>
                      <label className="flex items-center gap-1.5 text-xs text-slate-500">Review by <input type="date" value={d.due_date ?? ""} onChange={(e) => changeDue(d, e.target.value)} className="rounded border border-slate-200 px-1.5 py-1 text-xs" /></label>
                      <button onClick={() => removeDoc(d)} className="ml-auto text-xs text-red-400 hover:text-red-600 hover:underline">Delete document</button>
                    </div>
                    {adding === d.id && (
                      <div className="rounded-xl bg-slate-50 px-4 py-3 space-y-2">
                        <PeoplePicker staff={staff} chosen={addChosen} setChosen={setAddChosen} skip={mine.map((a) => a.employee_id)} />
                        <button onClick={() => addPeople(d)} disabled={addChosen.length === 0 || busy === `add:${d.id}`} className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: "#e8622a" }}>{busy === `add:${d.id}` ? "Adding…" : "Add and email them"}</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

export default function ReviewAdminPage() {
  return (
    <AppIdentityGate>
      {(identity) => identity.canAdmin
        ? <AdminBody />
        : <main className="min-h-screen flex items-center justify-center" style={{ background: "#f5f5f5" }}><p className="text-slate-600">This page is for admins.</p></main>}
    </AppIdentityGate>
  );
}
