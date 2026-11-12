"use client";

import { useState, useEffect, useCallback } from "react";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import { Sidebar } from "@/components/Sidebar";
import { getSessionToken } from "@/lib/secureData";

/**
 * Secret Santa, player side: join, fill in a wishlist (3 things you'd love, 3 things you'd rather not get),
 * then see who you're buying for and ask them questions without giving yourself away.
 */

interface Q { id: string; question: string; answer: string | null }
interface State {
  event: null | { id: string; title: string; budget: number; exchangeDate: string | null; location: string | null; wishlistDue: string | null; notes: string | null; status: "open" | "drawn" | "revealed" | "closed" };
  players?: string[];
  me?: { wants: string[]; avoid: string[]; about: string; giftReady: boolean } | null;
  giftee?: { name: string; wants: string[]; avoid: string[]; about: string; questions: Q[] } | null;
  questionsForMe?: Q[];
  mySanta?: string | null;
}

const RED = "#b91c1c";
const ORANGE = "#e8622a";
const GREEN = "#15803d";

async function api(body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch("/api/santa/mine", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Couldn't reach the server." } }; }
}

const day = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");
const three = (list: string[] | undefined) => [0, 1, 2].map((i) => list?.[i] ?? "");

function SantaBody({ identity }: { identity: AppIdentity }) {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [wants, setWants] = useState(["", "", ""]);
  const [avoid, setAvoid] = useState(["", "", ""]);
  const [about, setAbout] = useState("");
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await api({ action: "state" });
    if (!r.ok) { setError(r.json.error ?? "Couldn't load Secret Santa."); return; }
    setError(""); setS(r.json);
    if (r.json.me) {
      setWants(three(r.json.me.wants)); setAvoid(three(r.json.me.avoid)); setAbout(r.json.me.about ?? "");
      setEditing((r.json.me.wants ?? []).length === 0);
    }
  }, []);
  useEffect(() => { if (identity.mode === "staff") load(); }, [identity.mode, load]);

  async function act(body: Record<string, unknown>, done?: string) {
    setBusy(true); setMsg("");
    const r = await api(body);
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Something went wrong."); return false; }
    if (done) setMsg(done);
    await load();
    return true;
  }

  if (identity.mode !== "staff") {
    return <Shell><Card>Secret Santa is played under each person's own PIN. Log off and log back in with your own PIN to join. To set it up, use <a href="/santa-admin" className="underline font-semibold" style={{ color: ORANGE }}>Secret Santa Admin</a>.</Card></Shell>;
  }
  if (error) return <Shell><Card><span className="text-red-600 font-semibold">⚠️ {error}</span></Card></Shell>;
  if (!s) return <Shell><p className="text-sm text-slate-400">Loading…</p></Shell>;
  if (!s.event) return <Shell><Card><div className="text-5xl mb-2">🎄</div>No Secret Santa running right now. Check back closer to the holidays!</Card></Shell>;

  const e = s.event;
  const joined = !!s.me;

  return (
    <Shell>
      {/* The event */}
      <div className="rounded-2xl shadow p-5 text-white" style={{ background: `linear-gradient(135deg, ${RED}, #7f1d1d)` }}>
        <p className="text-xs uppercase tracking-widest opacity-80">🎅 Secret Santa</p>
        <p className="text-2xl font-bold mt-1" style={{ fontFamily: "'Poppins', sans-serif" }}>{e.title}</p>
        <div className="flex flex-wrap gap-2 mt-3 text-sm">
          <span className="rounded-full bg-white/20 px-3 py-1 font-semibold">${e.budget.toFixed(0)} max</span>
          {e.exchangeDate && <span className="rounded-full bg-white/20 px-3 py-1">🎁 {day(e.exchangeDate)}{e.location ? ` · ${e.location}` : ""}</span>}
          {e.wishlistDue && e.status === "open" && <span className="rounded-full bg-white/20 px-3 py-1">📝 Wishlists by {day(e.wishlistDue)}</span>}
        </div>
        {e.notes && <p className="text-sm mt-3 opacity-90">{e.notes}</p>}
      </div>

      {msg && <p className={`text-sm font-semibold ${msg.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>{msg}</p>}

      {!joined && (
        <Card>
          {e.status === "open" ? (
            <>
              <p className="font-semibold text-slate-700">Want in?</p>
              <p className="text-sm text-slate-500 mt-1 mb-4">Join, add a quick wishlist, and you'll get a name when the organizer draws.</p>
              <button onClick={() => act({ action: "join" }, "✓ You're in! Now add your wishlist.")} disabled={busy}
                className="rounded-xl px-6 py-3 font-semibold text-white" style={{ background: RED }}>🎅 Count me in</button>
            </>
          ) : (
            <p className="text-sm">Names have already been drawn. If you'd like to join, ask the organizer.</p>
          )}
        </Card>
      )}

      {/* Who you're buying for */}
      {joined && s.giftee && (
        <div className="rounded-2xl bg-white shadow p-5">
          <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">You're the Secret Santa for</p>
          {!revealed ? (
            <button onClick={() => setRevealed(true)} className="mt-3 w-full rounded-xl py-6 text-lg font-bold text-white" style={{ background: GREEN }}>
              🎁 Tap to see who you got
            </button>
          ) : (
            <>
              <p className="text-3xl font-bold mt-1" style={{ color: GREEN, fontFamily: "'Poppins', sans-serif" }}>{s.giftee.name}</p>
              <p className="text-xs text-slate-400 mt-1">Shh. Tap “Hide” before you hand your phone to anyone. <button className="underline" onClick={() => setRevealed(false)}>Hide</button></p>
              <div className="grid gap-3 sm:grid-cols-2 mt-4">
                <ListBox title="They'd love" emoji="💚" items={s.giftee.wants} empty="No wishlist yet. Ask them a question below." color={GREEN} />
                <ListBox title="Please don't get" emoji="🚫" items={s.giftee.avoid} empty="Nothing listed." color={RED} />
              </div>
              {s.giftee.about && <p className="text-sm text-slate-600 mt-3 rounded-xl bg-slate-50 p-3"><b>About them:</b> {s.giftee.about}</p>}

              <div className="mt-5">
                <p className="font-semibold text-slate-700 text-sm">Ask them something, anonymously</p>
                <p className="text-xs text-slate-400 mb-2">They see the question but not who asked. Sizes, favorite snacks, coffee or tea…</p>
                {s.giftee.questions.map((q) => (
                  <div key={q.id} className="rounded-xl bg-slate-50 p-3 mb-2 text-sm">
                    <p className="text-slate-700">❓ {q.question}</p>
                    <p className={q.answer ? "text-slate-800 font-semibold mt-1" : "text-slate-400 mt-1 italic"}>{q.answer ? `💬 ${q.answer}` : "No answer yet"}</p>
                  </div>
                ))}
                {e.status === "drawn" && (
                  <div className="flex gap-2">
                    <input value={question} onChange={(ev) => setQuestion(ev.target.value)} placeholder="Type a question" maxLength={300}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
                    <button disabled={busy || !question.trim()} onClick={async () => { if (await act({ action: "ask", question }, "✓ Sent. You'll see their answer here.")) setQuestion(""); }}
                      className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" style={{ background: ORANGE }}>Send</button>
                  </div>
                )}
              </div>
            </>
          )}
          {e.status === "drawn" && (
            <label className="flex items-center gap-2 mt-5 text-sm font-semibold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={!!s.me?.giftReady} onChange={(ev) => act({ action: "giftReady", ready: ev.target.checked })} className="w-5 h-5 accent-green-700" />
              I've got my gift
            </label>
          )}
        </div>
      )}

      {joined && e.status === "revealed" && s.mySanta && (
        <Card><div className="text-4xl mb-1">🎉</div>Your Secret Santa was <b className="text-slate-800">{s.mySanta}</b>!</Card>
      )}

      {/* Questions from my Secret Santa */}
      {joined && (s.questionsForMe?.length ?? 0) > 0 && (
        <div className="rounded-2xl bg-white shadow p-5">
          <p className="font-semibold text-slate-700">Questions from your Secret Santa</p>
          <p className="text-xs text-slate-400 mb-3">Your Secret Santa is shopping for you and wants to know. Answer so they can pick something you'll like.</p>
          {s.questionsForMe!.map((q) => (
            <div key={q.id} className="rounded-xl bg-slate-50 p-3 mb-2 text-sm">
              <p className="text-slate-700">❓ {q.question}</p>
              {q.answer ? (
                <p className="text-slate-800 font-semibold mt-1">💬 {q.answer}</p>
              ) : e.status === "drawn" ? (
                <div className="flex gap-2 mt-2">
                  <input value={answers[q.id] ?? ""} onChange={(ev) => setAnswers((a) => ({ ...a, [q.id]: ev.target.value }))} placeholder="Your answer" maxLength={500}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none bg-white" />
                  <button disabled={busy || !(answers[q.id] ?? "").trim()} onClick={() => act({ action: "answer", questionId: q.id, answer: answers[q.id] }, "✓ Answer sent.")}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40" style={{ background: ORANGE }}>Answer</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* My wishlist */}
      {joined && (
        <div className="rounded-2xl bg-white shadow p-5">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-700">My wishlist</p>
            {!editing && e.status !== "revealed" && <button onClick={() => setEditing(true)} className="text-sm font-semibold hover:underline" style={{ color: ORANGE }}>Edit</button>}
          </div>
          {editing ? (
            <div className="mt-3 space-y-4">
              <div>
                <p className="text-sm font-semibold" style={{ color: GREEN }}>💚 3 things I'd love</p>
                {wants.map((w, i) => (
                  <input key={i} value={w} onChange={(ev) => setWants((l) => l.map((x, j) => (j === i ? ev.target.value : x)))} maxLength={200}
                    placeholder={["e.g. A cozy throw blanket", "e.g. Dark chocolate", "e.g. A plant for my desk"][i]}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mt-1.5 focus:outline-none" />
                ))}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: RED }}>🚫 3 things I'd rather not get</p>
                {avoid.map((w, i) => (
                  <input key={i} value={w} onChange={(ev) => setAvoid((l) => l.map((x, j) => (j === i ? ev.target.value : x)))} maxLength={200}
                    placeholder={["e.g. Scented candles", "e.g. Mugs", "e.g. Anything with nuts"][i]}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mt-1.5 focus:outline-none" />
                ))}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-700">A little about me <span className="font-normal text-slate-400">(optional)</span></p>
                <textarea value={about} onChange={(ev) => setAbout(ev.target.value)} rows={3} maxLength={600}
                  placeholder="Favorite snacks, colors, coffee or tea, hobbies, sizes…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mt-1.5 focus:outline-none" />
              </div>
              <div className="flex items-center gap-3">
                <button disabled={busy} onClick={async () => { if (await act({ action: "saveWishlist", wants, avoid, about }, "✓ Wishlist saved.")) setEditing(false); }}
                  className="rounded-xl px-5 py-2.5 font-semibold text-white" style={{ background: RED }}>Save wishlist</button>
                {(s.me?.wants.length ?? 0) > 0 && <button onClick={() => setEditing(false)} className="text-sm text-slate-500 underline">Cancel</button>}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 mt-3">
              <ListBox title="I'd love" emoji="💚" items={s.me!.wants} empty="Nothing yet" color={GREEN} />
              <ListBox title="Please don't get me" emoji="🚫" items={s.me!.avoid} empty="Nothing listed" color={RED} />
              {s.me!.about && <p className="sm:col-span-2 text-sm text-slate-600"><b>About me:</b> {s.me!.about}</p>}
            </div>
          )}
          {e.status === "open" && (
            <p className="text-xs text-slate-400 mt-4">Names haven't been drawn yet. Changed your mind? <button disabled={busy} onClick={() => { if (confirm("Leave Secret Santa?")) act({ action: "leave" }, "✓ You've left Secret Santa."); }} className="underline">Leave</button></p>
          )}
        </div>
      )}

      {/* How it works */}
      <div className="rounded-2xl bg-white shadow p-5 text-sm text-slate-600">
        <p className="font-semibold text-slate-700 mb-2">How it works</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Join and add your wishlist: 3 things you'd love and 3 you'd rather not get.</li>
          <li>The organizer draws names. Nobody, not even the organizer, can see who has whom.</li>
          <li>Open this page to see who you got and their wishlist. Ask them questions here without giving yourself away.</li>
          <li>Spend ${e.budget.toFixed(0)} or less, wrap it with their name on it, and bring it {e.exchangeDate ? `on ${day(e.exchangeDate)}` : "to the exchange"}.</li>
          <li>At the party, everyone guesses their Secret Santa before the big reveal.</li>
        </ol>
        {(s.players?.length ?? 0) > 0 && (
          <div className="mt-4">
            <p className="text-xs text-slate-400 mb-1.5">{s.players!.length} playing</p>
            <div className="flex flex-wrap gap-1.5">{s.players!.map((n) => <span key={n} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{n}</span>)}</div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function ListBox({ title, emoji, items, empty, color }: { title: string; emoji: string; items: string[]; empty: string; color: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "#f8fafc" }}>
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{emoji} {title}</p>
      {items.length === 0 ? <p className="text-sm text-slate-400 mt-1">{empty}</p> : (
        <ul className="mt-1 space-y-0.5">{items.map((x, i) => <li key={i} className="text-sm text-slate-700">• {x}</li>)}</ul>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <div className="max-w-2xl space-y-4">
          <h1 className="text-2xl font-bold">🎅 Secret Santa</h1>
          {children}
        </div>
      </div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-white shadow p-6 text-center text-slate-600">{children}</div>;
}

export default function SecretSantaPage() {
  return <AppIdentityGate>{(identity) => <SantaBody identity={identity} />}</AppIdentityGate>;
}
