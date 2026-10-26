"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate from "@/components/AppIdentityGate";
import { getSessionToken } from "@/lib/secureData";
import { supabase } from "@/lib/supabase";

interface Item { text: string; x: number | null; y: number | null }
interface Setup { id: string; title: string; group: string; items: Item[]; url: string }

const ORANGE = "#e8622a";
const NUMBERS_KEY = "dd_setup_numbers";

async function api(body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch("/api/setups", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Network error." } }; }
}

// Phone photos are big (and sometimes HEIC). Shrink to a web-friendly JPEG before uploading; fall back to the original.
async function prepare(file: File): Promise<{ blob: Blob; type: string }> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    if (blob) return { blob, type: "image/jpeg" };
  } catch { /* use the original */ }
  return { blob: file, type: file.type };
}

// ---------------- One set-up: photo with numbered dots, and its index ----------------
function Detail({ setup, admin, groups, onBack, onChanged }: { setup: Setup; admin: boolean; groups: string[]; onBack: () => void; onChanged: () => void }) {
  const [showNums, setShowNums] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(setup.title);
  const [group, setGroup] = useState(setup.group);
  const [items, setItems] = useState<Item[]>(setup.items);
  const [placing, setPlacing] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const rows = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { try { if (localStorage.getItem(NUMBERS_KEY) === "off") setShowNums(false); } catch { /* ignore */ } }, []);
  function toggleNums() { const v = !showNums; setShowNums(v); try { localStorage.setItem(NUMBERS_KEY, v ? "on" : "off"); } catch { /* ignore */ } }

  const shown = editing ? items : setup.items;
  const dots = showNums || editing;

  function pos(e: { clientX: number; clientY: number }) {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }
  function clickPhoto(e: React.MouseEvent) {
    if (!editing) return;
    const p = pos(e);
    if (placing != null) { setItems((l) => l.map((it, i) => (i === placing ? { ...it, ...p } : it))); setPlacing(null); return; }
    setItems((l) => [...l, { text: "", ...p }]);
    setTimeout(() => rows.current[items.length]?.focus(), 0);
  }
  function startDrag(e: React.PointerEvent, i: number) {
    if (!editing) return;
    e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = i;
  }
  function moveDrag(e: React.PointerEvent) {
    if (drag.current == null) return;
    const p = pos(e), i = drag.current;
    setItems((l) => l.map((it, k) => (k === i ? { ...it, ...p } : it)));
  }
  const setText = (i: number, text: string) => setItems((l) => l.map((it, k) => (k === i ? { ...it, text } : it)));
  const remove = (i: number) => { setItems((l) => l.filter((_, k) => k !== i)); setPlacing(null); };
  function shift(i: number, d: number) {
    setItems((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setPlacing(null);
  }
  function startEdit() { setTitle(setup.title); setGroup(setup.group); setItems(setup.items); setPlacing(null); setErr(""); setEditing(true); }
  async function save() {
    if (!title.trim()) { setErr("Enter a title."); return; }
    setBusy(true); setErr("");
    const r = await api({ action: "update", id: setup.id, title, group, items: items.filter((it) => it.text.trim() || it.x != null) });
    setBusy(false);
    if (!r.ok) { setErr(r.json.error ?? "Couldn't save."); return; }
    setEditing(false); onChanged();
  }
  async function del() {
    if (!window.confirm(`Delete "${setup.title}" and its photo? This can't be undone.`)) return;
    setBusy(true);
    const r = await api({ action: "delete", id: setup.id });
    setBusy(false);
    if (!r.ok) { setErr(r.json.error ?? "Couldn't delete."); return; }
    onChanged(); onBack();
  }

  const dot = (i: number, it: Item) => (
    <div key={i} onPointerDown={(e) => startDrag(e, i)} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }}
      onClick={(e) => e.stopPropagation()} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
      title={it.text}
      style={{
        position: "absolute", left: `${(it.x ?? 0) * 100}%`, top: `${(it.y ?? 0) * 100}%`, transform: `translate(-50%,-50%) scale(${hover === i ? 1.25 : 1})`,
        width: 30, height: 30, borderRadius: 15, background: placing === i ? "#0f766e" : ORANGE, color: "#fff", fontWeight: 700, fontSize: 14,
        display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,.5)",
        cursor: editing ? "grab" : "default", touchAction: "none", userSelect: "none", transition: "transform .1s",
      }}>{i + 1}</div>
  );

  return (
    <div className="max-w-5xl">
      <button onClick={onBack} className="text-sm text-orange-600 hover:underline mb-3">← All set-ups</button>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {editing ? (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-lg font-bold flex-1 min-w-[12rem]" />
            <input value={group} onChange={(e) => setGroup(e.target.value)} list="setup-groups" placeholder="Group (optional)" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-48" />
          </>
        ) : (
          <div className="flex-1 min-w-[12rem]"><h2 className="text-xl font-bold">{setup.title}</h2>{setup.group && <p className="text-sm text-slate-500">{setup.group}</p>}</div>
        )}
        {!editing && (
          <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer select-none" style={{ minHeight: 44 }}>
            <input type="checkbox" checked={showNums} onChange={toggleNums} style={{ width: 20, height: 20, accentColor: ORANGE }} />Show numbers on photo
          </label>
        )}
        {admin && !editing && <button onClick={startEdit} className="rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50" style={{ height: 44 }}>Edit</button>}
      </div>
      <datalist id="setup-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>

      {editing && (
        <p className="text-sm rounded-lg px-3 py-2 mb-3" style={{ background: "#FAEEDA", color: "#854F0B" }}>
          {placing != null ? `Tap the photo to place number ${placing + 1}.` : "Tap the photo to drop the next number, then type what it is in the list. Drag a number to move it."}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] items-start">
        <div ref={boxRef} onClick={clickPhoto} className="relative rounded-xl overflow-hidden bg-slate-200 select-none" style={{ cursor: editing ? "crosshair" : "default" }}>
          {setup.url ? <img src={setup.url} alt={setup.title} draggable={false} className="w-full block" /> : <div className="p-10 text-center text-slate-500 text-sm">Photo unavailable. Reload the page.</div>}
          {dots && shown.map((it, i) => (it.x != null && it.y != null ? dot(i, it) : null))}
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-3">
          <h3 className="font-bold mb-2">Index</h3>
          {shown.length === 0 && <p className="text-sm text-slate-400">{editing ? "Nothing yet. Tap the photo to add the first number." : "No index has been added."}</p>}
          <ol className="space-y-1.5">
            {shown.map((it, i) => (
              <li key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="flex items-center gap-2 rounded-lg px-1.5 py-1" style={{ background: hover === i ? "#fff4ec" : "transparent" }}>
                <span className="shrink-0 flex items-center justify-center text-white font-bold text-sm" style={{ width: 26, height: 26, borderRadius: 13, background: it.x == null ? "#94a3b8" : ORANGE }}>{i + 1}</span>
                {editing ? (
                  <>
                    <input ref={(el) => { rows.current[i] = el; }} value={it.text} onChange={(e) => setText(i, e.target.value)} placeholder="What is this?" className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-sm" />
                    <button onClick={() => setPlacing(placing === i ? null : i)} className="text-xs font-semibold px-1.5" style={{ color: "#0f766e" }}>{it.x == null ? "Place" : "Move"}</button>
                    <button onClick={() => shift(i, -1)} aria-label="Move up" className="text-slate-500 px-1">↑</button>
                    <button onClick={() => shift(i, 1)} aria-label="Move down" className="text-slate-500 px-1">↓</button>
                    <button onClick={() => remove(i)} aria-label="Remove" className="text-red-500 px-1">✕</button>
                  </>
                ) : <span className="text-sm">{it.text}</span>}
              </li>
            ))}
          </ol>
          {editing && <button onClick={() => { setItems((l) => [...l, { text: "", x: null, y: null }]); setTimeout(() => rows.current[items.length]?.focus(), 0); }} className="mt-2 text-sm font-semibold text-orange-600 hover:underline">+ Add a line</button>}
        </div>
      </div>

      {err && <p className="text-sm font-semibold text-red-600 mt-3">{err}</p>}
      {editing && (
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button onClick={save} disabled={busy} className="rounded-lg px-5 text-sm font-semibold text-white" style={{ height: 44, background: ORANGE }}>{busy ? "Saving…" : "Save"}</button>
          <button onClick={() => { setEditing(false); setErr(""); }} className="text-sm text-slate-600" style={{ height: 44 }}>Cancel</button>
          <span className="flex-1" />
          <button onClick={del} disabled={busy} className="text-sm text-red-600 hover:underline" style={{ height: 44 }}>Delete this set-up</button>
        </div>
      )}
    </div>
  );
}

// ---------------- Add a set-up ----------------
function AddDialog({ groups, onClose, onAdded }: { groups: string[]; onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);

  async function submit() {
    if (!title.trim()) { setErr("Enter a title."); return; }
    if (!file) { setErr("Choose a photo."); return; }
    setBusy(true); setErr("");
    const { blob, type } = await prepare(file);
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) { setBusy(false); setErr("Use a JPG, PNG or WebP photo."); return; }
    const slot = await api({ action: "uploadSlot", size: blob.size, contentType: type });
    if (!slot.ok) { setBusy(false); setErr(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("setups").uploadToSignedUrl(slot.json.path, slot.json.token, blob, { contentType: type });
    if (up.error) { setBusy(false); setErr(`Upload failed: ${up.error.message}`); return; }
    const r = await api({ action: "create", title, group, path: slot.json.path });
    setBusy(false);
    if (!r.ok) { setErr(r.json.error ?? "Couldn't save."); return; }
    onAdded(); onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: "rgba(0,0,0,.45)" }} onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-md mt-10 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Add a set-up</h2>
        <div><label htmlFor="su-title" className="block text-sm font-semibold mb-1">Title</label>
          <input id="su-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Crown prep tray" className="w-full rounded-lg border border-slate-300 px-3" style={{ height: 44 }} /></div>
        <div><label htmlFor="su-group" className="block text-sm font-semibold mb-1">Group (optional)</label>
          <input id="su-group" value={group} onChange={(e) => setGroup(e.target.value)} list="add-groups" placeholder="Pick one or type a new group" className="w-full rounded-lg border border-slate-300 px-3" style={{ height: 44 }} />
          <datalist id="add-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></div>
        <div><label htmlFor="su-file" className="block text-sm font-semibold mb-1">Photo</label>
          <input id="su-file" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
          {preview && <img src={preview} alt="" className="mt-2 rounded-lg max-h-48" />}</div>
        {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
        <div className="flex items-center gap-3 pt-1">
          <button onClick={submit} disabled={busy} className="rounded-lg px-5 text-sm font-semibold text-white" style={{ height: 44, background: ORANGE }}>{busy ? "Uploading…" : "Add set-up"}</button>
          <button onClick={onClose} className="text-sm text-slate-600" style={{ height: 44 }}>Cancel</button>
        </div>
        <p className="text-xs text-slate-500">After it&apos;s added, open it and tap Edit to number the items on the photo.</p>
      </div>
    </div>
  );
}

// ---------------- Page ----------------
function SetupsBody() {
  const [setups, setSetups] = useState<Setup[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState("");

  async function load() {
    const r = await api({ action: "list" });
    if (!r.ok) setErr(r.json.error ?? "Couldn't load set-ups."); else { setErr(""); setSetups(r.json.setups ?? []); setAdmin(!!r.json.admin); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => [...new Set(setups.map((s) => s.group).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [setups]);
  const open = setups.find((s) => s.id === openId);
  const visible = setups.filter((s) => !filter || (filter === "__none" ? !s.group : s.group === filter));
  const sections = [...groups.filter((g) => visible.some((s) => s.group === g)), ...(visible.some((s) => !s.group) ? [""] : [])];

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[12rem]"><h1 className="text-2xl font-bold">Set-ups</h1><p className="text-sm text-slate-500 mt-1">Photos of how things are set up, with a numbered index.</p></div>
          {admin && !open && <button onClick={() => setAddOpen(true)} className="rounded-lg px-4 text-sm font-semibold text-white" style={{ height: 44, background: ORANGE }}>+ Add set-up</button>}
        </header>

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : err ? <p className="text-sm font-semibold text-red-600">{err}</p> : open ? (
          <Detail key={open.id} setup={open} admin={admin} groups={groups} onBack={() => setOpenId(null)} onChanged={load} />
        ) : (
          <div className="max-w-5xl">
            {setups.length === 0 && <p className="text-sm text-slate-500">{admin ? "No set-ups yet. Tap “+ Add set-up” to add the first one." : "No set-ups have been added yet."}</p>}
            {groups.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {[["", "All"], ...groups.map((g) => [g, g]), ...(setups.some((s) => !s.group) ? [["__none", "Ungrouped"]] : [])].map(([v, label]) => (
                  <button key={v} onClick={() => setFilter(v)} className="px-3 text-sm font-semibold rounded-full border" style={{ height: 36, ...(filter === v ? { background: ORANGE, color: "#fff", borderColor: ORANGE } : { background: "#fff", color: "#334155", borderColor: "#cbd5e1" }) }}>{label}</button>
                ))}
              </div>
            )}
            {sections.map((g) => (
              <section key={g || "none"} className="mb-6">
                {(groups.length > 0) && <h2 className="font-bold text-slate-700 mb-2">{g || "Ungrouped"}</h2>}
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {visible.filter((s) => s.group === g).map((s) => (
                    <button key={s.id} onClick={() => setOpenId(s.id)} className="text-left rounded-xl bg-white border border-slate-200 overflow-hidden hover:shadow-md transition">
                      <div className="bg-slate-200" style={{ aspectRatio: "4 / 3" }}>{s.url && <img src={s.url} alt="" className="w-full h-full object-cover" />}</div>
                      <div className="p-2.5"><p className="font-semibold text-sm leading-snug">{s.title}</p><p className="text-xs text-slate-500">{s.items.length} item{s.items.length === 1 ? "" : "s"} in index</p></div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      {addOpen && <AddDialog groups={groups} onClose={() => setAddOpen(false)} onAdded={load} />}
    </main>
  );
}

export default function SetupsPage() {
  return <AppIdentityGate>{() => <SetupsBody />}</AppIdentityGate>;
}
