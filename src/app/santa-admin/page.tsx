"use client";

import { useState, useEffect, useCallback } from "react";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import { Sidebar } from "@/components/Sidebar";
import { getSessionToken } from "@/lib/secureData";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";

/**
 * Secret Santa Admin: set the budget and date, see who's in and who still needs a wishlist,
 * set exclusions, draw names, and reveal after the party. Admins only.
 * The organizer never sees who drew whom until they press Reveal, so they can play too.
 */

interface Ev { id: string; title: string; budget: number; exchange_date: string | null; location: string | null; wishlist_due: string | null; notes: string | null; status: "open" | "drawn" | "revealed" | "closed" }
interface Person { employeeId: number; name: string; hasWishlist: boolean; giftReady: boolean }
interface Excl { id: string; a: number; b: number; aName: string; bName: string }
interface AdminState { event: Ev | null; participants?: Person[]; exclusions?: Excl[]; pairs?: { giver: string; recipient: string }[] }

const RED = "#b91c1c";
const ORANGE = "#e8622a";
const GREEN = "#15803d";

async function api(body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch("/api/santa/admin", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Couldn't reach the server." } }; }
}

function mailNote(j: any, what: string): string {
  if (j.failed) return `⚠️ ${what}, but the emails didn't go out. Check the email settings.`;
  const parts = [`✓ ${what}.`];
  if (typeof j.emailed === "number") parts.push(`${j.emailed} emailed.`);
  if (j.noEmail?.length) parts.push(`No email on file for ${j.noEmail.join(", ")}; let them know in person.`);
  return parts.join(" ");
}

const STATUS_LABEL: Record<Ev["status"], string> = { open: "Collecting wishlists", drawn: "Names drawn", revealed: "Revealed", closed: "Closed" };

function SantaAdminBody({ identity }: { identity: AppIdentity }) {
  const [s, setS] = useState<AdminState | null>(null);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "Deccan Dental Secret Santa", budget: "20", exchangeDate: "2026-12-11", location: "Flores, San Mateo", wishlistDue: "", notes: "" });
  const [editingEvent, setEditingEvent] = useState(false);
  const [addIds, setAddIds] = useState<number[]>([]);
  const [exA, setExA] = useState("");
  const [exB, setExB] = useState("");
  const [showPairs, setShowPairs] = useState(false);

  const load = useCallback(async () => {
    const r = await api({ action: "state" });
    if (!r.ok) { setError(r.json.error ?? "Couldn't load Secret Santa."); return; }
    setError(""); setS(r.json);
    const e: Ev | null = r.json.event;
    if (e) setForm({ title: e.title, budget: String(e.budget), exchangeDate: e.exchange_date ?? "", location: e.location ?? "", wishlistDue: e.wishlist_due ?? "", notes: e.notes ?? "" });
  }, []);
  useEffect(() => {
    if (!identity.canAdmin) return;
    load();
    loadStaff().then((list) => setStaff(list.filter((x) => !x.archived)));
  }, [identity.canAdmin, load]);

  async function act(body: Record<string, unknown>, describe?: (j: any) => string) {
    setBusy(true); setMsg("");
    const r = await api({ eventId: s?.event?.id, ...body });
    setBusy(false);
    if (!r.ok) { setMsg(`⚠️ ${r.json.error ?? "Something went wrong."}`); return false; }
    if (describe) setMsg(describe(r.json));
    await load();
    return true;
  }

  if (!identity.canAdmin) return <Shell><p className="rounded-xl bg-white shadow px-5 py-4 text-sm text-slate-600">Only admins can run Secret Santa.</p></Shell>;
  if (error) return <Shell><p className="text-sm font-semibold text-red-600">⚠️ {error}</p></Shell>;
  if (!s) return <Shell><p className="text-sm text-slate-400">Loading…</p></Shell>;

  const EventForm = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={input} /></Field>
      <Field label="Budget ($ max)"><input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className={input} /></Field>
      <Field label="Gift exchange date"><input type="date" value={form.exchangeDate} onChange={(e) => setForm({ ...form, exchangeDate: e.target.value })} className={input} /></Field>
      <Field label="Where"><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Flores, San Mateo" className={input} /></Field>
      <Field label="Wishlists due"><input type="date" value={form.wishlistDue} onChange={(e) => setForm({ ...form, wishlistDue: e.target.value })} className={input} /></Field>
      <Field label="Note for everyone (optional)"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Bring your gift wrapped with the person's name on it" className={input} /></Field>
    </div>
  );

  if (!s.event) {
    return (
      <Shell>
        <div className="rounded-2xl bg-white shadow p-5 space-y-4 max-w-3xl">
          <p className="font-semibold text-slate-700">Start a Secret Santa</p>
          {EventForm}
          <button disabled={busy} onClick={() => act({ action: "create", ...form }, () => "✓ Secret Santa is open. Use “Invite everyone” to email the team.")}
            className="rounded-xl px-5 py-2.5 font-semibold text-white" style={{ background: RED }}>Open Secret Santa</button>
          {msg && <p className="text-sm font-semibold">{msg}</p>}
        </div>
      </Shell>
    );
  }

  const e = s.event;
  const people = s.participants ?? [];
  const inIds = new Set(people.map((p) => p.employeeId));
  const notIn = staff.filter((x) => !inIds.has(x.id));
  const missing = people.filter((p) => !p.hasWishlist);
  const ready = people.filter((p) => p.giftReady).length;

  return (
    <Shell>
      <div className="max-w-4xl space-y-4">
        {msg && <p className={`text-sm font-semibold ${msg.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>{msg}</p>}

        {/* Event */}
        <div className="rounded-2xl bg-white shadow p-5">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="font-bold text-slate-800 text-lg">{e.title}</p>
            <span className="text-xs font-semibold rounded-full px-2.5 py-0.5" style={{ background: e.status === "open" ? "#fef3c7" : "#dcfce7", color: e.status === "open" ? "#92400e" : GREEN }}>{STATUS_LABEL[e.status]}</span>
            <div className="flex-1" />
            {!editingEvent && <button onClick={() => setEditingEvent(true)} className="text-sm font-semibold hover:underline" style={{ color: ORANGE }}>Edit details</button>}
          </div>
          {editingEvent ? (
            <div className="mt-4 space-y-3">
              {EventForm}
              <div className="flex gap-3">
                <button disabled={busy} onClick={async () => { if (await act({ action: "update", ...form }, () => "✓ Saved.")) setEditingEvent(false); }} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: ORANGE }}>Save</button>
                <button onClick={() => setEditingEvent(false)} className="text-sm text-slate-500 underline">Cancel</button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 mt-1">
              ${Number(e.budget).toFixed(0)} max
              {e.exchange_date && ` · exchange ${new Date(e.exchange_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`}
              {e.location && ` at ${e.location}`}
              {e.wishlist_due && ` · wishlists due ${new Date(e.wishlist_due + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
            </p>
          )}
        </div>

        {/* Steps */}
        <div className="rounded-2xl bg-white shadow p-5 space-y-3">
          <p className="font-semibold text-slate-700">Run it</p>
          <Step n={1} title="Invite the team" done={people.length > 0}>
            <button disabled={busy || e.status !== "open"} onClick={() => act({ action: "invite" }, (j) => mailNote(j, "Invites sent to everyone who hasn't joined"))} className={btn}>✉️ Invite everyone who isn't in yet</button>
          </Step>
          <Step n={2} title={`Wishlists (${people.length - missing.length} of ${people.length} done)`} done={people.length > 0 && missing.length === 0}>
            <button disabled={busy || missing.length === 0} onClick={() => act({ action: "remindWishlists" }, (j) => mailNote(j, "Reminders sent"))} className={btn}>🔔 Remind people with no wishlist</button>
          </Step>
          <Step n={3} title="Draw names" done={e.status !== "open"}>
            {e.status === "open" ? (
              <button disabled={busy || people.length < 3} onClick={() => {
                if (!confirm(`Draw names for ${people.length} people now? Everyone gets an email saying names are drawn.${missing.length ? ` ${missing.length} still have no wishlist; their Secret Santa can ask them questions in the app.` : ""}`)) return;
                act({ action: "draw" }, (j) => mailNote(j, `Names drawn for ${j.people} people`));
              }} className={btnMain}>🎲 Draw names</button>
            ) : e.status === "drawn" ? (
              <button disabled={busy} onClick={() => { if (confirm("Undo the draw? Everyone's match and their questions are cleared, and you'll need to draw again.")) act({ action: "undoDraw" }, () => "✓ Draw undone. You can change who's in and draw again."); }} className={btn}>↩️ Undo the draw</button>
            ) : null}
            {e.status === "open" && people.length < 3 && <span className="text-xs text-slate-400">Needs at least 3 people.</span>}
          </Step>
          <Step n={4} title={`Gifts bought (${ready} of ${people.length})`} done={e.status !== "open" && ready === people.length && people.length > 0}>
            <span className="text-xs text-slate-400">Each person ticks “I've got my gift” in the app.</span>
          </Step>
          <Step n={5} title="Reveal after the party" done={e.status === "revealed"}>
            {e.status === "drawn" && <button disabled={busy} onClick={() => { if (confirm("Reveal everyone's Secret Santa? Each person will see who had them.")) act({ action: "reveal" }, () => "✓ Revealed. Everyone can see who their Secret Santa was."); }} className={btn}>🎉 Reveal everyone's Secret Santa</button>}
            {e.status === "revealed" && <button onClick={() => setShowPairs((v) => !v)} className={btn}>{showPairs ? "Hide" : "Show"} who had whom</button>}
          </Step>
          {showPairs && s.pairs && (
            <div className="rounded-xl bg-slate-50 p-3 text-sm grid sm:grid-cols-2 gap-1">
              {s.pairs.map((p) => <p key={p.giver}><b>{p.giver}</b> → {p.recipient}</p>)}
            </div>
          )}
        </div>

        {/* People */}
        <div className="rounded-2xl bg-white shadow p-5">
          <p className="font-semibold text-slate-700 mb-3">Who's in ({people.length})</p>
          {people.length === 0 ? <p className="text-sm text-slate-400">No one yet.</p> : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {people.map((p) => (
                <div key={p.employeeId} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="flex-1 font-semibold text-slate-700">{p.name}</span>
                  <span className="text-xs" style={{ color: p.hasWishlist ? GREEN : "#b45309" }}>{p.hasWishlist ? "✓ wishlist" : "no wishlist"}</span>
                  {e.status !== "open" && <span className="text-xs" style={{ color: p.giftReady ? GREEN : "#94a3b8" }}>{p.giftReady ? "🎁 ready" : "shopping"}</span>}
                  {e.status === "open" && <button onClick={() => { if (confirm(`Remove ${p.name} from Secret Santa?`)) act({ action: "removePerson", employeeId: p.employeeId }); }} className="text-slate-300 hover:text-red-500">✕</button>}
                </div>
              ))}
            </div>
          )}
          {e.status === "open" && notIn.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-slate-400 mb-1.5">Add someone yourself (for example, someone who doesn't use the app much):</p>
              <div className="flex flex-wrap gap-1.5">
                {notIn.map((x) => {
                  const on = addIds.includes(x.id);
                  return <button key={x.id} onClick={() => setAddIds(on ? addIds.filter((i) => i !== x.id) : [...addIds, x.id])}
                    className="rounded-full px-3 py-1 text-xs font-semibold border" style={on ? { background: ORANGE, color: "#fff", borderColor: ORANGE } : { background: "#fff", color: "#475569", borderColor: "#e2e8f0" }}>{x.name}</button>;
                })}
              </div>
              {addIds.length > 0 && <button disabled={busy} onClick={async () => { if (await act({ action: "addPeople", employeeIds: addIds }, () => "✓ Added.")) setAddIds([]); }} className={`${btn} mt-2`}>Add {addIds.length}</button>}
            </div>
          )}
        </div>

        {/* Exclusions */}
        <div className="rounded-2xl bg-white shadow p-5">
          <p className="font-semibold text-slate-700">Don't pair these people</p>
          <p className="text-xs text-slate-400 mb-3">For family members or anyone who shouldn't draw each other. Works both ways.</p>
          {(s.exclusions ?? []).map((x) => (
            <div key={x.id} className="flex items-center gap-2 text-sm py-1">
              <span>{x.aName} ↔ {x.bName}</span>
              {e.status === "open" && <button onClick={() => act({ action: "removeExclusion", id: x.id })} className="text-slate-300 hover:text-red-500">✕</button>}
            </div>
          ))}
          {e.status === "open" && people.length >= 2 && (
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <select value={exA} onChange={(ev) => setExA(ev.target.value)} className={sel}><option value="">Person</option>{people.map((p) => <option key={p.employeeId} value={p.employeeId}>{p.name}</option>)}</select>
              <span className="text-slate-400">↔</span>
              <select value={exB} onChange={(ev) => setExB(ev.target.value)} className={sel}><option value="">Person</option>{people.map((p) => <option key={p.employeeId} value={p.employeeId}>{p.name}</option>)}</select>
              <button disabled={busy || !exA || !exB || exA === exB} onClick={async () => { if (await act({ action: "addExclusion", a: Number(exA), b: Number(exB) })) { setExA(""); setExB(""); } }} className={btn}>Add</button>
            </div>
          )}
        </div>

        <div className="text-xs text-slate-400">
          Done for the year?{" "}
          <button className="underline" onClick={() => { if (confirm("Close this Secret Santa? It disappears from everyone's app and you can start a new one next year.")) act({ action: "close" }, () => "✓ Closed."); }}>Close this Secret Santa</button>
        </div>
      </div>
    </Shell>
  );
}

const input = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none";
const sel = "rounded-lg border border-slate-200 px-2 py-1.5 text-sm bg-white";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40";
const btnMain = "rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 bg-red-700";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs text-slate-400 mb-0.5">{label}</label>{children}</div>;
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={done ? { background: GREEN, color: "#fff" } : { background: "#f1f5f9", color: "#64748b" }}>{done ? "✓" : n}</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <div className="flex items-center gap-2 flex-wrap mt-1">{children}</div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <h1 className="text-2xl font-bold">🎁 Secret Santa Admin</h1>
        <p className="text-sm text-slate-500 mb-4 max-w-3xl">Staff join and play from <a href="/secret-santa" className="underline font-semibold" style={{ color: ORANGE }}>🎅 Secret Santa</a>. You can play too: the draw is hidden from everyone, including you, until you press Reveal.</p>
        {children}
      </div>
    </main>
  );
}

export default function SantaAdminPage() {
  return <AppIdentityGate>{(identity) => <SantaAdminBody identity={identity} />}</AppIdentityGate>;
}
