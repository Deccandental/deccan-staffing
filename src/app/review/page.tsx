"use client";

import { useState, useEffect, useCallback } from "react";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import { Sidebar } from "@/components/Sidebar";
import { getSessionToken } from "@/lib/secureData";

/**
 * Documents sent to you to review. Open the document, then tick the box and type your initials to confirm.
 * You only ever see documents assigned to you.
 */

interface Item { id: string; opened_at: string | null; reviewed_at: string | null; initials: string | null; doc: { title: string; note: string; due_date: string | null; file_name: string; created_at: string } }

async function api(body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch("/api/reviews/mine", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Couldn't reach the server." } }; }
}

const fmt = (d: string) => new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function ReviewBody({ identity }: { identity: AppIdentity }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [initials, setInitials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api({ action: "list" });
    setLoading(false);
    if (!r.ok) { setError(r.json.error ?? "Couldn't load your documents."); return; }
    setError(""); setItems(r.json.items ?? []);
  }, []);
  useEffect(() => { if (identity.mode === "staff") load(); else setLoading(false); }, [identity.mode, load]);

  async function openDoc(it: Item) {
    setMsg("");
    // Open the tab right away (browsers block pop-ups opened after a wait), then point it at the document.
    const w = window.open("", "_blank");
    setBusy(`open:${it.id}`);
    const r = await api({ action: "open", assignmentId: it.id });
    setBusy("");
    if (!r.ok) { if (w) w.close(); setMsg(r.json.error ?? "Couldn't open the document."); return; }
    if (w) w.location.href = r.json.url; else window.location.href = r.json.url;
    load();
  }

  async function confirm(it: Item) {
    setMsg("");
    setBusy(`ack:${it.id}`);
    const r = await api({ action: "acknowledge", assignmentId: it.id, initials: initials[it.id] ?? "" });
    setBusy("");
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't save your review."); return; }
    setMsg(`Thank you. "${it.doc.title}" is marked as reviewed.`); load();
  }

  const today = new Date().toISOString().slice(0, 10);
  const todo = items.filter((i) => !i.reviewed_at).sort((a, b) => (a.doc.due_date ?? "9999").localeCompare(b.doc.due_date ?? "9999"));
  const done = items.filter((i) => i.reviewed_at).sort((a, b) => String(b.reviewed_at).localeCompare(String(a.reviewed_at)));

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <div className="max-w-3xl space-y-4">
          <div>
            <h1 className="text-2xl font-bold">Documents to review</h1>
            <p className="text-sm text-slate-500">Open each document, read it, then tick the box and type your initials to confirm.</p>
          </div>

          {identity.mode !== "staff" && (
            <div className="rounded-xl bg-white shadow px-5 py-4 text-sm text-slate-600">Documents are sent to individual staff members. Log in with your own PIN to see yours.</div>
          )}
          {error && <p className="text-sm font-semibold text-red-600">⚠️ {error}</p>}
          {msg && <p className="text-sm font-semibold text-slate-700">{msg}</p>}
          {loading && <p className="text-sm text-slate-400">Loading…</p>}

          {identity.mode === "staff" && !loading && (
            <>
              {todo.length === 0 && <div className="rounded-xl bg-white shadow px-5 py-4 text-sm text-slate-600">✅ Nothing waiting for your review.</div>}
              {todo.map((it) => {
                const overdue = !!it.doc.due_date && it.doc.due_date < today;
                const opened = !!it.opened_at;
                const ready = !!checked[it.id] && /^[A-Za-z]{2,6}$/.test((initials[it.id] ?? "").trim());
                return (
                  <div key={it.id} className="rounded-2xl bg-white shadow px-5 py-4 space-y-3" style={{ borderLeft: `4px solid ${overdue ? "#dc2626" : "#e8622a"}` }}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="font-bold text-slate-800">{it.doc.title}</h2>
                        <p className="text-xs text-slate-400">Sent {fmt(it.doc.created_at)}{it.doc.due_date ? ` · please review by ${fmt(it.doc.due_date)}` : ""}</p>
                      </div>
                      {overdue && <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "#fee2e2", color: "#991b1b" }}>Past due</span>}
                    </div>
                    {it.doc.note && <p className="text-sm text-slate-600 whitespace-pre-line">{it.doc.note}</p>}
                    <div>
                      <button onClick={() => openDoc(it)} disabled={busy === `open:${it.id}`} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#0f766e" }}>
                        {busy === `open:${it.id}` ? "Opening…" : opened ? "Open document again" : "Open document"}
                      </button>
                      {!opened && <span className="ml-3 text-xs text-slate-400">Open it first, then you can confirm.</span>}
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3 space-y-2" style={{ opacity: opened ? 1 : 0.5 }}>
                      <label className="flex items-start gap-2 text-sm text-slate-700">
                        <input type="checkbox" disabled={!opened} checked={!!checked[it.id]} onChange={(e) => setChecked((c) => ({ ...c, [it.id]: e.target.checked }))} className="mt-1" />
                        <span>I have reviewed this document.</span>
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <input value={initials[it.id] ?? ""} disabled={!opened} onChange={(e) => setInitials((m) => ({ ...m, [it.id]: e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 6).toUpperCase() }))}
                          placeholder="Initials" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold tracking-widest focus:outline-none" style={{ width: 110 }} />
                        <button onClick={() => confirm(it)} disabled={!opened || !ready || busy === `ack:${it.id}`} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" style={{ backgroundColor: "#e8622a" }}>
                          {busy === `ack:${it.id}` ? "Saving…" : "Confirm review"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {done.length > 0 && (
                <div className="rounded-2xl bg-white shadow px-5 py-4">
                  <h2 className="font-bold text-sm text-slate-700 mb-2">Reviewed</h2>
                  {done.map((it) => (
                    <div key={it.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5 border-t border-slate-100 first:border-0 text-sm">
                      <span className="flex-1 min-w-0 truncate text-slate-700">{it.doc.title}</span>
                      <span className="text-xs text-slate-400">Reviewed {fmt(it.reviewed_at!)} · {it.initials}</span>
                      <button onClick={() => openDoc(it)} className="text-xs text-slate-500 underline hover:text-slate-700">Open again</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ReviewPage() {
  return <AppIdentityGate>{(identity) => <ReviewBody identity={identity} />}</AppIdentityGate>;
}
