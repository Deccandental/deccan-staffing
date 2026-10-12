'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { compressImage } from '../lib/image';
import { Field, PickOrNew, StatusBadge, stockState } from './ui';

// A "set-up" is one row of the `sets` table: name, optional group, optional photo with numbered
// dots (points), and its items (set_items). A numbered line can link to an item or to another set-up.

const NUMS_KEY = 'dd_setup_show_numbers';
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const clamp = (n) => Math.min(100, Math.max(0, n));
const r2 = (n) => Math.round(n * 100) / 100;

async function uploadBlob(out, nameHint) {
  const ext = out.type === 'image/jpeg' ? 'jpg' : ((nameHint || 'x.jpg').split('.').pop() || 'jpg').toLowerCase();
  const path = `setups/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from('item-images').upload(path, out, { upsert: true, contentType: out.type || undefined });
  if (error) throw new Error(error.message);
  return supabase.storage.from('item-images').getPublicUrl(path).data.publicUrl;
}

async function uploadSetupPhoto(file) {
  const out = await compressImage(file, 1600, 0.82);
  return uploadBlob(out, file.name);
}

// Rotate the stored photo 90 degrees (dir = 1 clockwise, -1 counter-clockwise) and upload the result.
async function rotatePhoto(url, dir) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load the photo (' + res.status + ')');
  const objUrl = URL.createObjectURL(await res.blob());
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Could not read the photo')); i.src = objUrl; });
    const c = document.createElement('canvas');
    c.width = img.naturalHeight; c.height = img.naturalWidth;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Could not rotate the photo');
    return await uploadBlob(blob, 'rotated.jpg');
  } finally { URL.revokeObjectURL(objUrl); }
}

// Suggest inventory items that resemble the text typed into a line label
function suggestItems(items, text) {
  const toks = (text || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (toks.length === 0) return [];
  return items
    .filter((i) => !i.archived)
    .map((i) => {
      const hay = `${i.name || ''} ${i.sku || ''} ${i.item_id || ''} ${i.manufacturer || ''} ${i.category || ''}`.toLowerCase();
      const name = (i.name || '').toLowerCase();
      let score = 0;
      toks.forEach((t) => { if (hay.includes(t)) score += 1; if (name.startsWith(t)) score += 0.5; });
      return { i, score };
    })
    .filter((x) => x.score >= Math.min(toks.length, 2))
    .sort((a, b) => b.score - a.score || (a.i.name || '').localeCompare(b.i.name || ''))
    .slice(0, 6)
    .map((x) => x.i);
}

function cleanPoints(points) {
  return points.map((p) => ({
    id: p.id,
    label: (p.label || '').trim(),
    x: p.x == null ? null : r2(p.x),
    y: p.y == null ? null : r2(p.y),
    item_id: p.item_id || null,
    set_id: p.set_id || null,
  }));
}

// ---------- Add set-up modal ----------
function AddSetupModal({ groups, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [group, setGroup] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const image_url = file ? await uploadSetupPhoto(file) : null;
      const { data, error } = await supabase.from('sets')
        .insert({ name: title.trim(), group_name: group.trim() || null, image_url, points: [] })
        .select().single();
      if (error) throw new Error(error.message + ' (has 05_merge_sets_setups.sql been run in Supabase?)');
      onCreated(data);
    } catch (e) {
      alert('Could not add set-up: ' + (e?.message || e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add set-up</h2>
        <div className="form">
          <Field label="Name *" full><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Operatory 1 — hygiene tray, or Crown Bur Set" autoFocus /></Field>
          <Field label="Group (optional)" full>
            <PickOrNew noun="group" value={group} options={groups} onChange={setGroup} />
          </Field>
          <div className="field full">
            <span>Photo (optional — you can add one later)</span>
            <label className="btn-secondary file-btn setup-filebtn">
              {file ? 'Change photo' : 'Choose or take a photo'}
              <input type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            {preview && <img src={preview} alt="" className="setup-add-preview" />}
          </div>
        </div>
        <div className="modal-actions">
          <div className="spacer" />
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : 'Add set-up'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Detail / edit modal ----------
function SetupDetail({ setup, items, itemByCode, sets, setRows, groups, isAdmin, initialNum, autoEdit, onClose, onChanged, onGoToItem, onOpenSetup, onScanAdd }) {
  const [draft, setDraft] = useState(null); // null = viewing
  const [sel, setSel] = useState(null);
  const [placingId, setPlacingId] = useState(null);
  const [linkFor, setLinkFor] = useState(null);
  const [linkQ, setLinkQ] = useState('');
  const [showNums, setShowNums] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [typeFor, setTypeFor] = useState(null); // line whose label box is showing suggestions
  const [addQ, setAddQ] = useState('');
  const photoRef = useRef(null);
  const dragRef = useRef(null);
  const lineRefs = useRef({});

  const setById = (id) => (id ? sets.find((x) => x.id === id) : null);
  // every item in a set-up: its listed items plus anything linked on a numbered line
  const itemsOf = (st) => {
    const ids = new Set(setRows.filter((r) => r.set_id === st.id).map((r) => r.item_id));
    (st.points || []).forEach((p) => { if (p.item_id) ids.add(p.item_id); });
    return Array.from(ids).map((id) => itemByCode(id)).filter(Boolean).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  };

  const editing = !!draft;
  const data = draft || setup;
  const points = data.points || [];
  const hasPhoto = !!data.image_url;
  const dotIds = new Set(points.map((p) => p.item_id).filter(Boolean));
  // listed items that aren't already shown on a numbered line
  const otherItems = setRows.filter((r) => r.set_id === setup.id).map((r) => itemByCode(r.item_id))
    .filter((it) => it && !dotIds.has(it.item_id)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const listedIds = new Set(setRows.filter((r) => r.set_id === setup.id).map((r) => r.item_id));

  useEffect(() => {
    try { if (localStorage.getItem(NUMS_KEY) === '0') setShowNums(false); } catch (_) {}
  }, []);
  function toggleNums(v) {
    setShowNums(v);
    try { localStorage.setItem(NUMS_KEY, v ? '1' : '0'); } catch (_) {}
  }

  // jump to a specific number when opened from an item
  useEffect(() => {
    if (initialNum && setup.points?.[initialNum - 1]) {
      const id = setup.points[initialNum - 1].id;
      setSel(id);
      setTimeout(() => lineRefs.current[id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 150);
    }
  }, [initialNum, setup.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (autoEdit && isAdmin) startEdit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit() {
    setDraft({
      name: setup.name,
      group_name: setup.group_name || '',
      image_url: setup.image_url || null,
      points: (setup.points || []).map((p) => ({ ...p })),
    });
    setPlacingId(null); setLinkFor(null);
  }
  function cancelEdit() {
    if (JSON.stringify(cleanPoints(draft.points)) !== JSON.stringify(cleanPoints(setup.points || [])) ||
        draft.name !== setup.name || (draft.group_name || '') !== (setup.group_name || '') || (draft.image_url || null) !== (setup.image_url || null)) {
      if (!confirm('Discard your changes to this set-up?')) return;
    }
    setDraft(null); setPlacingId(null); setLinkFor(null);
  }

  const setPoints = (fn) => setDraft((d) => ({ ...d, points: fn(d.points) }));
  const patchPoint = (id, patch) => setPoints((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  function pctFromEvent(e) {
    const r = photoRef.current.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) };
  }

  function onPhotoClick(e) {
    if (!editing) { setSel(null); return; }
    const { x, y } = pctFromEvent(e);
    if (placingId) {
      patchPoint(placingId, { x, y });
      setSel(placingId);
      setPlacingId(null);
      return;
    }
    const p = { id: uid(), label: '', x, y, item_id: null, set_id: null };
    setPoints((ps) => [...ps, p]);
    setSel(p.id);
    setTimeout(() => lineRefs.current[p.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }

  function dotDown(e, p) {
    if (!editing) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { id: p.id };
    setSel(p.id);
  }
  function dotMove(e) {
    if (!dragRef.current) return;
    const { x, y } = pctFromEvent(e);
    patchPoint(dragRef.current.id, { x, y });
  }
  function dotUp(e) {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  }
  function dotClick(e, p) {
    e.stopPropagation();
    setSel(p.id);
    lineRefs.current[p.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function move(idx, dir) {
    setPoints((ps) => {
      const j = idx + dir;
      if (j < 0 || j >= ps.length) return ps;
      const a = [...ps];
      [a[idx], a[j]] = [a[j], a[idx]];
      return a;
    });
  }
  function removeLine(id) {
    const p = points.find((x) => x.id === id);
    if (!confirm(`Remove line ${points.indexOf(p) + 1}${p?.label ? ' — ' + p.label : ''}? The numbers after it shift up.`)) return;
    setPoints((ps) => ps.filter((x) => x.id !== id));
    if (sel === id) setSel(null);
    if (placingId === id) setPlacingId(null);
  }
  function addLine() {
    const p = { id: uid(), label: '', x: null, y: null, item_id: null, set_id: null };
    setPoints((ps) => [...ps, p]);
    setSel(p.id);
  }
  function linkItem(pid, item) {
    patchPoint(pid, { item_id: item.item_id, set_id: null, label: item.name }); // linked lines take the inventory item's name
    setLinkFor(null); setLinkQ(''); setTypeFor(null);
  }
  function linkSet(pid, st) {
    patchPoint(pid, { set_id: st.id, item_id: null, label: st.name }); // ...or the other set-up's name
    setLinkFor(null); setLinkQ(''); setTypeFor(null);
  }

  async function changePhoto(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPhotoBusy(true);
    try {
      const url = await uploadSetupPhoto(f);
      setDraft((d) => ({ ...d, image_url: url }));
    } catch (err) { alert('Photo upload failed: ' + (err?.message || err)); }
    setPhotoBusy(false);
  }

  async function rotate(dir) {
    if (!confirm('Rotate the photo ' + (dir > 0 ? 'right' : 'left') + '? Your dots turn with it.')) return;
    setPhotoBusy(true);
    try {
      const url = await rotatePhoto(draft.image_url, dir);
      setDraft((d) => ({
        ...d,
        image_url: url,
        points: d.points.map((p) => (p.x == null || p.y == null ? p
          : dir > 0 ? { ...p, x: 100 - p.y, y: p.x } : { ...p, x: p.y, y: 100 - p.x })),
      }));
    } catch (err) { alert('Rotate failed: ' + (err?.message || err)); }
    setPhotoBusy(false);
  }

  async function save() {
    if (!draft.name.trim()) { alert('Give the set-up a name.'); return; }
    setSaving(true);
    const { error } = await supabase.from('sets').update({
      name: draft.name.trim(),
      group_name: (draft.group_name || '').trim() || null,
      image_url: draft.image_url || null,
      points: cleanPoints(draft.points.map((p) => {
        const it = p.item_id ? itemByCode(p.item_id) : null;
        const st = p.set_id ? setById(p.set_id) : null;
        return it ? { ...p, label: it.name } : st ? { ...p, label: st.name } : p;
      })),
    }).eq('id', setup.id);
    setSaving(false);
    if (error) { alert('Save failed: ' + error.message); return; }
    setDraft(null); setPlacingId(null); setLinkFor(null);
    onChanged();
  }
  async function del() {
    if (!confirm(`Delete the set-up "${setup.name}", its photo dots and its item list?\nInventory items themselves are NOT deleted.`)) return;
    await supabase.from('set_items').delete().eq('set_id', setup.id);
    const { error } = await supabase.from('sets').delete().eq('id', setup.id);
    if (error) { alert(error.message); return; }
    onChanged();
    onClose();
  }

  // items in this set-up's list (add / remove straight away)
  async function addMember(item) {
    const { error } = await supabase.from('set_items').insert({ set_id: setup.id, item_id: item.item_id });
    if (error && error.code !== '23505') { alert(error.message); return; }
    setAddQ('');
    onChanged();
  }
  async function removeMember(item) {
    await supabase.from('set_items').delete().eq('set_id', setup.id).eq('item_id', item.item_id);
    onChanged();
  }

  const linkResults = useMemo(() => {
    const q = linkQ.trim().toLowerCase();
    if (!q) return [];
    return items.filter((i) => !i.archived && (
      (i.name || '').toLowerCase().includes(q) ||
      (i.sku || '').toLowerCase().includes(q) ||
      (i.item_id || '').toLowerCase().includes(q))).slice(0, 8);
  }, [items, linkQ]);
  const linkSetResults = useMemo(() => {
    const q = linkQ.trim().toLowerCase();
    if (!q) return [];
    return sets.filter((x) => x.id !== setup.id && (x.name || '').toLowerCase().includes(q)).slice(0, 5);
  }, [sets, linkQ, setup.id]);
  const addResults = useMemo(() => {
    const q = addQ.trim().toLowerCase();
    if (!q) return [];
    return items.filter((i) => !i.archived && !listedIds.has(i.item_id) && (
      (i.name || '').toLowerCase().includes(q) ||
      (i.sku || '').toLowerCase().includes(q) ||
      (i.item_id || '').toLowerCase().includes(q))).slice(0, 8);
  }, [items, addQ, setRows, setup.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dotsVisible = editing || showNums;

  // Give a listed item a number: put it on an existing free line, or start a new numbered line for it
  function assignToNumber(it, target) {
    if (!target) return;
    if (target === '__new__') {
      const np = { id: uid(), label: it.name, x: null, y: null, item_id: it.item_id, set_id: null };
      setPoints((ps) => [...ps, np]);
      setSel(np.id);
      setTimeout(() => lineRefs.current[np.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 80);
      return;
    }
    patchPoint(target, { item_id: it.item_id, set_id: null, label: it.name });
    setSel(target);
    setTimeout(() => lineRefs.current[target]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 80);
  }

  function itemMini(it, extra) {
    return (
      <div className="setup-member" key={it.id}>
        <div className="setup-member-name">{it.name} <span className="idpill">{it.item_id}</span></div>
        <div className="setup-member-qty"><b>{it.current_qty ?? 0}</b> <StatusBadge item={it} />{it.ordered_at && <span className="chip onorder">on order</span>}</div>
        <button className="btn-secondary sm" onClick={() => onGoToItem(it)}>Open ›</button>
        {extra}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={editing ? undefined : onClose}>
      <div className="modal setup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          {editing
            ? <div className="setup-edit-head">
                <input className="setup-title-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" />
                <PickOrNew key={setup.id + '-g'} noun="group" value={draft.group_name} options={groups}
                  onChange={(v) => setDraft((d) => ({ ...d, group_name: v }))} />
              </div>
            : <div>
                <h2 style={{ margin: 0 }}>{setup.name}</h2>
                {setup.group_name && <div className="setup-group-tag">{setup.group_name}</div>}
              </div>}
          <div className="setup-head-actions">
            {isAdmin && !editing && <button className="btn-secondary" onClick={startEdit}>Edit</button>}
            {!editing && <button className="btn-secondary" onClick={onClose}>Close</button>}
          </div>
        </div>

        {editing && hasPhoto && (
          <div className="setup-banner">
            {placingId
              ? <>Tap the photo to place dot <b>{points.findIndex((p) => p.id === placingId) + 1}</b>. <button className="btn-ghost" onClick={() => setPlacingId(null)}>Cancel</button></>
              : <>Tap the photo to drop a numbered dot · drag a dot to move it.</>}
          </div>
        )}

        {hasPhoto && (
          <div className={'setup-photo' + (editing ? ' editing' : '') + (placingId ? ' placing' : '')} ref={photoRef} onClick={onPhotoClick}>
            <img src={data.image_url} alt={data.name} draggable={false} />
            {dotsVisible && points.map((p, i) => (p.x == null || p.y == null) ? null : (
              <div key={p.id}
                className={'setup-dot' + (sel === p.id ? ' sel' : '') + (editing ? ' drag' : '') + ((p.item_id || p.set_id) ? ' linked' : '')}
                style={{ left: p.x + '%', top: p.y + '%' }}
                onPointerDown={(e) => dotDown(e, p)} onPointerMove={dotMove} onPointerUp={dotUp} onPointerCancel={dotUp}
                onClick={(e) => dotClick(e, p)}>{i + 1}</div>
            ))}
          </div>
        )}

        {!editing && hasPhoto && points.length > 0 && (
          <label className="chk setup-numchk">
            <input type="checkbox" checked={showNums} onChange={(e) => toggleNums(e.target.checked)} /> Show numbers on photo
          </label>
        )}
        {editing && (
          <div className="setup-photo-actions">
            <label className="btn-secondary file-btn">
              {photoBusy ? 'Working…' : (hasPhoto ? 'Change photo' : 'Add photo')}
              <input type="file" accept="image/*" hidden onChange={changePhoto} disabled={photoBusy} />
            </label>
            {hasPhoto && <button className="btn-secondary" disabled={photoBusy} onClick={() => rotate(-1)}>⟲ Rotate left</button>}
            {hasPhoto && <button className="btn-secondary" disabled={photoBusy} onClick={() => rotate(1)}>⟳ Rotate right</button>}
            {hasPhoto && <button className="btn-ghost" disabled={photoBusy} onClick={() => setDraft((d) => ({ ...d, image_url: null }))}>Remove photo</button>}
          </div>
        )}

        {(hasPhoto || points.length > 0) && (
          <>
            <h3 className="setup-index-h">Numbered</h3>
            {points.length === 0 && (
              <div className="empty setup-empty">
                {editing ? 'No dots yet. Tap the photo to drop dot 1.' : 'Nothing numbered on this photo yet.'}
              </div>
            )}
          </>
        )}

        <div className="setup-index">
          {points.map((p, i) => {
            const item = p.item_id ? itemByCode(p.item_id) : null;
            const lset = p.set_id ? setById(p.set_id) : null;
            const missing = p.item_id && !item;
            const missingSet = p.set_id && !lset;
            const unplaced = p.x == null || p.y == null;
            return (
              <div key={p.id} ref={(el) => { lineRefs.current[p.id] = el; }}
                className={'setup-line' + (sel === p.id ? ' sel' : '')}
                onClick={() => setSel(p.id)}>
                <div className={'setup-num' + (unplaced && editing ? ' unplaced' : '')}>{i + 1}</div>

                {editing ? (
                  <div className="setup-line-edit">
                    {item
                      ? <div className="setup-label-linked">{item.name} <span className="idpill">{item.item_id}</span></div>
                      : lset
                      ? <div className="setup-label-linked">{lset.name} <span className="chip setchip">SET-UP · {itemsOf(lset).length} items</span></div>
                      : <input className="setup-label-input" value={p.label} placeholder="What is it? (similar items and set-ups appear as you type)"
                          onFocus={() => setTypeFor(p.id)}
                          onBlur={() => setTimeout(() => setTypeFor((t) => (t === p.id ? null : t)), 200)}
                          onChange={(e) => { patchPoint(p.id, { label: e.target.value }); setTypeFor(p.id); }} />}
                    {!item && !lset && typeFor === p.id && (() => {
                      const sug = suggestItems(items, p.label);
                      const ql = (p.label || '').trim().toLowerCase();
                      const sugSets = ql.length >= 2 ? sets.filter((x) => x.id !== setup.id && (x.name || '').toLowerCase().includes(ql)).slice(0, 3) : [];
                      return (sug.length > 0 || sugSets.length > 0) ? (
                        <div className="setup-suggest" onClick={(e) => e.stopPropagation()}>
                          <div className="setup-suggest-h">Similar inventory items and set-ups — tap to link</div>
                          {sugSets.map((st) => (
                            <button type="button" key={'s' + st.id} className="setup-suggest-row"
                              onMouseDown={(e) => e.preventDefault()} onClick={() => linkSet(p.id, st)}>
                              <span className="chip setchip">SET-UP</span> {st.name}
                              <span className="setup-suggest-qty">{itemsOf(st).length} items</span>
                            </button>
                          ))}
                          {sug.map((it) => (
                            <button type="button" key={it.id} className="setup-suggest-row"
                              onMouseDown={(e) => e.preventDefault()} onClick={() => linkItem(p.id, it)}>
                              <span className="idpill">{it.item_id}</span> {it.name}
                              <span className="setup-suggest-qty">{it.current_qty ?? 0} in stock</span>
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}
                    <div className="setup-line-tools">
                      {hasPhoto && (
                        <button className="btn-secondary sm" onClick={(e) => { e.stopPropagation(); setPlacingId(p.id); setSel(p.id); }}>
                          {unplaced ? 'Place' : 'Move'}
                        </button>
                      )}
                      <button className="btn-secondary sm" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, -1); }} title="Move up">↑</button>
                      <button className="btn-secondary sm" disabled={i === points.length - 1} onClick={(e) => { e.stopPropagation(); move(i, 1); }} title="Move down">↓</button>
                      <button className="btn-secondary sm" onClick={(e) => { e.stopPropagation(); setLinkFor(linkFor === p.id ? null : p.id); setLinkQ(''); }}>
                        {(p.item_id || p.set_id) ? 'Change link' : 'Link item / set-up'}
                      </button>
                      {(p.item_id || p.set_id) && <button className="btn-ghost sm" onClick={(e) => { e.stopPropagation(); patchPoint(p.id, { item_id: null, set_id: null }); }}>Unlink</button>}
                      <button className="btn-ghost sm danger" onClick={(e) => { e.stopPropagation(); removeLine(p.id); }} title="Remove line">✕</button>
                    </div>
                    {(item || lset) && <div className="hint">Name comes from the linked {item ? 'inventory item' : 'set-up'} — rename it there and it updates here. Unlink to type your own.</div>}
                    {missing && <div className="setup-linked-note">→ {p.item_id} <span className="setup-missing">(item not found)</span></div>}
                    {missingSet && <div className="setup-linked-note">→ linked set-up <span className="setup-missing">(was deleted)</span></div>}
                    {linkFor === p.id && (
                      <div className="setup-picker" onClick={(e) => e.stopPropagation()}>
                        <input autoFocus placeholder="Search inventory items or set-ups…" value={linkQ} onChange={(e) => setLinkQ(e.target.value)} />
                        {linkSetResults.map((st) => (
                          <div className="add-row" key={'s' + st.id}>
                            <div className="add-info"><span className="chip setchip">SET-UP</span> {st.name} <span className="muted">· {itemsOf(st).length} items</span></div>
                            <button className="btn-primary sm" onClick={() => linkSet(p.id, st)}>Link</button>
                          </div>
                        ))}
                        {linkQ.trim() && (linkResults.length === 0 && linkSetResults.length === 0
                          ? <div className="add-none">No matches.</div>
                          : linkResults.map((it) => (
                            <div className="add-row" key={it.id}>
                              <div className="add-info"><span className="idpill">{it.item_id}</span> {it.name}</div>
                              <button className="btn-primary sm" onClick={() => linkItem(p.id, it)}>Link</button>
                            </div>
                          )))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="setup-line-view">
                    <div className="setup-line-label">{item?.name || lset?.name || p.label || <span className="muted">(no label)</span>}</div>
                    {item && (
                      <div className="setup-item-card">
                        <div className="row-thumb sm">{item.image_url ? <img src={item.image_url} alt="" /> : <span className="ph">▢</span>}</div>
                        <div className="setup-item-main">
                          <div className="setup-item-name">{item.name} <span className="idpill">{item.item_id}</span></div>
                          <div className="setup-item-stock">
                            <b>{item.current_qty ?? 0}</b> in stock
                            {item.par_level != null && Number(item.par_level) > 0 && <span className="par-note"> · par {item.par_level}</span>}
                            {' '}<StatusBadge item={item} />
                            {item.ordered_at && <span className="chip onorder">on order</span>}
                          </div>
                        </div>
                        <button className="btn-secondary sm" onClick={(e) => { e.stopPropagation(); onGoToItem(item); }}>Open item ›</button>
                      </div>
                    )}
                    {lset && (() => {
                      const mem = itemsOf(lset);
                      const low = mem.filter((it) => ['low', 'out'].includes(stockState(it))).length;
                      return (
                        <>
                          <div className="setup-item-card">
                            <div className="row-thumb sm">{lset.image_url ? <img src={lset.image_url} alt="" /> : <span className="ph">▢</span>}</div>
                            <div className="setup-item-main">
                              <div className="setup-item-name">{lset.name} <span className="chip setchip">SET-UP</span></div>
                              <div className="setup-item-stock">
                                <b>{mem.length}</b> item{mem.length === 1 ? '' : 's'}
                                {low > 0 && <span className="badge reorder">{low} low / out</span>}
                              </div>
                            </div>
                            <button className="btn-secondary sm" onClick={(e) => { e.stopPropagation(); onOpenSetup(lset); }}>Open set-up ›</button>
                          </div>
                          {mem.length > 0 ? (
                            <div className="setup-members" onClick={(e) => e.stopPropagation()}>
                              {mem.map((it) => itemMini(it))}
                            </div>
                          ) : (
                            <div className="hint">This set-up has no items yet.</div>
                          )}
                        </>
                      );
                    })()}
                    {missing && <div className="setup-missing">Linked item {p.item_id} was deleted or renamed.</div>}
                    {missingSet && <div className="setup-missing">The linked set-up was deleted.</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {editing && hasPhoto && (
          <div className="setup-addline">
            <button className="btn-secondary" onClick={addLine}>+ Add line</button>
            <span className="hint"> (adds a line with no dot — use Place to put it on the photo)</span>
          </div>
        )}
        {editing && !hasPhoto && (
          <div className="setup-addline">
            <button className="btn-secondary" onClick={addLine}>+ Add numbered line</button>
            <span className="hint"> (optional — add a photo above to place numbered dots)</span>
          </div>
        )}

        {/* Items listed in this set-up (the old "Sets" kit list) */}
        {(editing || otherItems.length > 0) && (
          <>
            <h3 className="setup-index-h">{points.some((p) => p.item_id) ? 'Other items in this set-up' : 'Items in this set-up'}</h3>
            {editing && (
              <div className="setup-picker">
                <div className="setup-add-items">
                  <input placeholder="Search inventory to add items…" value={addQ} onChange={(e) => setAddQ(e.target.value)} />
                  <button className="btn-scan" onClick={() => onScanAdd(setup.id)}>Scan to add</button>
                </div>
                {addQ.trim() && (addResults.length === 0
                  ? <div className="add-none">No matches.</div>
                  : addResults.map((it) => (
                    <div className="add-row" key={it.id}>
                      <div className="add-info"><span className="idpill">{it.item_id}</span> {it.name}</div>
                      <button className="btn-primary sm" onClick={() => addMember(it)}>Add</button>
                    </div>
                  )))}
              </div>
            )}
            {otherItems.length === 0 ? (
              <div className="hint">{editing ? 'No other items listed yet.' : ''}</div>
            ) : (
              <div className="setup-members">
                {otherItems.map((it) => itemMini(it, editing
                  ? (
                    <>
                      <select className="setup-assign" value="" title="Give this item a number on the photo"
                        onChange={(e) => assignToNumber(it, e.target.value)}>
                        <option value="">Assign to #…</option>
                        {points.map((p, i) => (p.item_id || p.set_id) ? null : (
                          <option key={p.id} value={p.id}>#{i + 1}{p.label ? ' — ' + p.label : ' (empty line)'}</option>
                        ))}
                        <option value="__new__">＋ New numbered line</option>
                      </select>
                      <button className="btn-ghost sm danger" title="Remove from this set-up" onClick={() => removeMember(it)}>✕</button>
                    </>
                  )
                  : null))}
              </div>
            )}
          </>
        )}

        {!editing && !hasPhoto && points.length === 0 && otherItems.length === 0 && (
          <div className="empty setup-empty">Nothing in this set-up yet.{isAdmin ? ' Tap Edit to add items or a photo.' : ''}</div>
        )}

        {editing && (
          <div className="modal-actions">
            <button className="btn-danger" onClick={del}>Delete set-up</button>
            <div className="spacer" />
            <button className="btn-secondary" onClick={cancelEdit} disabled={saving}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Page ----------
export default function SetupsView({ sets, setRows, items, itemByCode, isAdmin, open, setOpen, onChanged, onGoToItem, onScanAdd }) {
  const [groupFilter, setGroupFilter] = useState('');
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => Array.from(new Set(sets.map((s) => s.group_name).filter(Boolean))).sort(), [sets]);
  const hasUngrouped = sets.some((s) => !s.group_name);

  const shown = useMemo(() => sets.filter((s) => {
    if (!groupFilter) return true;
    if (groupFilter === '__none__') return !s.group_name;
    return s.group_name === groupFilter;
  }), [sets, groupFilter]);

  const byGroup = useMemo(() => {
    const g = {};
    shown.forEach((s) => { (g[s.group_name || 'Ungrouped'] ||= []).push(s); });
    Object.values(g).forEach((a) => a.sort((x, y) => (x.name || '').localeCompare(y.name || '')));
    return Object.entries(g).sort((a, b) => {
      if (a[0] === 'Ungrouped') return 1;
      if (b[0] === 'Ungrouped') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [shown]);

  const countItems = (st) => {
    const ids = new Set(setRows.filter((r) => r.set_id === st.id).map((r) => r.item_id));
    (st.points || []).forEach((p) => { if (p.item_id) ids.add(p.item_id); });
    return ids.size;
  };

  const openSetup = open ? sets.find((s) => s.id === open.id) : null;

  return (
    <>
      <div className="order-toolbar">
        <div className="count">{sets.length} set-up{sets.length === 1 ? '' : 's'}</div>
        <div className="spacer" />
        {isAdmin && <button className="btn-primary" onClick={() => setAdding(true)}>+ Add set-up</button>}
      </div>

      {(groups.length > 0 || hasUngrouped) && (
        <div className="setup-groupbar">
          <button className={!groupFilter ? 'grpbtn on' : 'grpbtn'} onClick={() => setGroupFilter('')}>All</button>
          {groups.map((g) => (
            <button key={g} className={groupFilter === g ? 'grpbtn on' : 'grpbtn'} onClick={() => setGroupFilter(g)}>{g}</button>
          ))}
          {hasUngrouped && groups.length > 0 && (
            <button className={groupFilter === '__none__' ? 'grpbtn on' : 'grpbtn'} onClick={() => setGroupFilter('__none__')}>Ungrouped</button>
          )}
        </div>
      )}

      {sets.length === 0 ? (
        <div className="empty">
          No set-ups yet.{isAdmin ? <> Tap <b>+ Add set-up</b> — add items, a photo with numbered dots, or both.</> : ' An admin can add the first one.'}
        </div>
      ) : (
        byGroup.map(([g, list]) => (
          <div className="cat-group" key={g}>
            <div className="cat-header setup-grouphead">{g} <span className="cat-count">{list.length}</span></div>
            <div className="setup-grid">
              {list.map((s) => {
                const n = (s.points || []).length;
                return (
                  <div className="setup-card" key={s.id} onClick={() => setOpen({ id: s.id, num: null })}>
                    <div className="setup-card-img">
                      {s.image_url ? <img src={s.image_url} alt={s.name} loading="lazy" /> : <div className="setup-card-noimg">▢</div>}
                    </div>
                    <div className="setup-card-body">
                      <div className="setup-card-title">{s.name}</div>
                      <div className="setup-card-sub">
                        {countItems(s)} item{countItems(s) === 1 ? '' : 's'}{n ? ` · ${n} numbered` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {adding && (
        <AddSetupModal groups={groups} onClose={() => setAdding(false)}
          onCreated={async (row) => { setAdding(false); await onChanged(); setOpen({ id: row.id, num: null, edit: true }); }} />
      )}

      {openSetup && (
        <SetupDetail key={openSetup.id} setup={openSetup} items={items} itemByCode={itemByCode} sets={sets} setRows={setRows} groups={groups}
          isAdmin={isAdmin} initialNum={open.num} autoEdit={!!open.edit}
          onClose={() => setOpen(null)} onChanged={onChanged} onGoToItem={onGoToItem}
          onOpenSetup={(st) => setOpen({ id: st.id, num: null })} onScanAdd={onScanAdd} />
      )}
    </>
  );
}
