"use client";

import { useState, useEffect, useMemo } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import SignaturePad from "@/components/SignaturePad";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";
import {
  PolicyDocument, PolicyVersion, PolicyRequirement, PolicySignature,
  loadPolicyDocuments, loadActiveVersion, loadLatestRequirement, loadAllRequirements,
  createRequirement, loadSignaturesForRequirement, loadMySignature,
  submitSignature, submitCountersignature, getCurrentSeptemberCycleYear,
} from "@/lib/policyDocs";

function DocumentPanel({ doc, identity, staff }: { doc: PolicyDocument; identity: AppIdentity; staff: Employee[] }) {
  const [version, setVersion] = useState<PolicyVersion | null>(null);
  const [requirement, setRequirement] = useState<PolicyRequirement | null>(null);
  const [mySignature, setMySignature] = useState<PolicySignature | null>(null);
  const [allSignatures, setAllSignatures] = useState<PolicySignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [signing, setSigning] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [typedName, setTypedName] = useState(identity.employeeName ?? "");
  const [sigImage, setSigImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [counterSigningId, setCounterSigningId] = useState<string | null>(null);
  const [counterName, setCounterName] = useState(identity.employeeName ?? "");
  const [counterSigImage, setCounterSigImage] = useState<string | null>(null);

  const myEmployeeId = identity.employeeId ?? null;
  const isAdmin = !!identity.canAdmin;

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    const v = await loadActiveVersion(doc.id);
    const req = await loadLatestRequirement(doc.id);
    setVersion(v);
    setRequirement(req);
    if (req && myEmployeeId != null) {
      const mine = await loadMySignature(req.id, myEmployeeId);
      setMySignature(mine);
    } else {
      setMySignature(null);
    }
    if (req && isAdmin) {
      const sigs = await loadSignaturesForRequirement(req.id);
      setAllSignatures(sigs);
    }
    setLoading(false);
  }

  const requiredSectionIdxs = useMemo(
    () => (version?.content ?? []).map((s, i) => (s.requiresInitial ? i : -1)).filter((i) => i >= 0),
    [version]
  );
  const allChecked = requiredSectionIdxs.every((i) => checked.has(i));

  const filteredContent = useMemo(() => {
    if (!version) return [];
    if (!search.trim()) return version.content.map((s, i) => ({ ...s, idx: i }));
    const q = search.toLowerCase();
    return version.content.map((s, i) => ({ ...s, idx: i })).filter((s) => s.heading.toLowerCase().includes(q) || s.body.toLowerCase().includes(q));
  }, [version, search]);

  async function handleStartCycle() {
    if (!version) return;
    const label = doc.cycleMode === "annual_september"
      ? `September ${getCurrentSeptemberCycleYear()}`
      : `${doc.title} — Version 1`;
    const created = await createRequirement(doc.id, version.id, label);
    if (created) {
      fetch("/api/policies/notify-new-cycle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirementId: created.id }),
      }).catch((err) => console.error("notify-new-cycle error:", err));
    }
    await refresh();
  }

  function toggleCheck(idx: number) {
    setChecked((s) => { const next = new Set(s); if (next.has(idx)) next.delete(idx); else next.add(idx); return next; });
  }

  async function handleSubmitSignature() {
    if (!requirement || myEmployeeId == null || !sigImage || !typedName.trim()) return;
    setSubmitting(true);
    await submitSignature({
      requirementId: requirement.id, employeeId: myEmployeeId, employeeName: identity.employeeName ?? typedName,
      typedName: typedName.trim(), signatureImage: sigImage, initials: Array.from(checked),
    });
    setSubmitting(false);
    setSigning(false);
    await refresh();
  }

  async function handleCountersign() {
    if (!counterSigningId || !counterSigImage || !counterName.trim()) return;
    await submitCountersignature(counterSigningId, counterName.trim(), counterSigImage);
    setCounterSigningId(null);
    setCounterSigImage(null);
    await refresh();
  }

  if (loading) return <p className="text-slate-400 text-sm">Loading…</p>;

  if (!version) {
    return <p className="text-sm text-slate-400">No content has been set up for this document yet.</p>;
  }

  if (!requirement) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
        <p className="text-sm text-amber-800 mb-2">No signing cycle has been started for this document yet.</p>
        {isAdmin && (
          <button onClick={handleStartCycle} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
            Start {doc.cycleMode === "annual_september" ? `September ${getCurrentSeptemberCycleYear()}` : "Signing"} Cycle
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mySignature ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-emerald-800">
            ✓ You signed <strong>{requirement.cycleLabel}</strong> on {new Date(mySignature.signedAt).toLocaleDateString()}.
            {mySignature.countersignedAt ? " Countersigned by management." : " Awaiting management countersignature."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-amber-800">Your signature is required for <strong>{requirement.cycleLabel}</strong>.</p>
          {!signing && <button onClick={() => setSigning(true)} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Start Signing</button>}
        </div>
      )}

      {isAdmin && (
        <button onClick={() => setShowAdmin((s) => !s)} className="text-xs text-slate-500 hover:underline">
          {showAdmin ? "Hide" : "Show"} admin compliance view
        </button>
      )}

      {isAdmin && showAdmin && (
        <div className="rounded-xl bg-white shadow p-4">
          <h3 className="font-bold text-slate-700 text-sm mb-2">{requirement.cycleLabel} — Compliance</h3>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {staff.filter((e) => !e.archived).map((e) => {
              const sig = allSignatures.find((s) => s.employeeId === e.id);
              return (
                <div key={e.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="text-slate-700">{e.name}</span>
                  {sig ? (
                    sig.countersignedAt ? (
                      <span className="text-emerald-600 text-xs font-semibold">✓ Fully signed</span>
                    ) : counterSigningId === sig.id ? (
                      <div className="flex items-center gap-2">
                        <input type="text" value={counterName} onChange={(ev) => setCounterName(ev.target.value)} placeholder="Your name"
                          className="w-28 rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:outline-none" />
                        <div className="w-28"><SignaturePad onChange={setCounterSigImage} /></div>
                        <button onClick={handleCountersign} className="text-xs text-white px-2 py-0.5 rounded" style={{ backgroundColor: "#e8622a" }}>Save</button>
                        <button onClick={() => setCounterSigningId(null)} className="text-xs text-slate-400">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setCounterSigningId(sig.id)} className="text-xs text-orange-500 hover:underline">Signed — Countersign</button>
                    )
                  ) : (
                    <span className="text-slate-400 text-xs">Not yet signed</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this document…"
          className="w-full max-w-sm rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
        <button onClick={() => window.print()} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 transition print:hidden">
          Print
        </button>
      </div>

      <div className="rounded-xl bg-white shadow p-5 space-y-4 max-h-[36rem] overflow-y-auto">
        {filteredContent.length === 0 ? (
          <p className="text-sm text-slate-400">No sections match "{search}".</p>
        ) : filteredContent.map((s) => (
          <div key={s.idx} className={s.isDivider ? "pt-2" : ""}>
            <h3 className={s.isDivider ? "font-bold text-slate-800" : "font-semibold text-slate-700 text-sm"}>{s.heading}</h3>
            {s.body && <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">{s.body}</p>}
            {signing && s.requiresInitial && (
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input type="checkbox" checked={checked.has(s.idx)} onChange={() => toggleCheck(s.idx)} />
                <span className="text-xs text-slate-500">I have read and initial this section.</span>
              </label>
            )}
          </div>
        ))}
      </div>

      {signing && !mySignature && (
        <div className="rounded-xl bg-white shadow p-4 space-y-3 print:hidden">
          <h3 className="font-bold text-slate-700 text-sm">Sign {doc.title}</h3>
          {!allChecked && <p className="text-xs text-amber-600">Please check every section above before signing ({checked.size} of {requiredSectionIdxs.length} initialed).</p>}
          <div>
            <label className="block text-xs text-slate-400 mb-0.5">Full Name</label>
            <input type="text" value={typedName} onChange={(e) => setTypedName(e.target.value)}
              className="w-full max-w-sm rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          </div>
          <div className="max-w-sm">
            <label className="block text-xs text-slate-400 mb-0.5">Signature</label>
            <SignaturePad onChange={setSigImage} />
          </div>
          <button onClick={handleSubmitSignature} disabled={!allChecked || !sigImage || !typedName.trim() || submitting}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40" style={{ backgroundColor: "#e8622a" }}>
            {submitting ? "Submitting…" : "Submit Signature"}
          </button>
        </div>
      )}
    </div>
  );
}

function HandbookPageBody({ identity }: { identity: AppIdentity }) {
  const [documents, setDocuments] = useState<PolicyDocument[]>([]);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>("handbook");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([loadPolicyDocuments(), loadStaff()]).then(([docs, s]) => {
      setDocuments(docs);
      setStaff(s);
      setLoading(false);
    });
  }, []);

  const activeDoc = documents.find((d) => d.slug === activeSlug);

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4 print:hidden">
          <h1 className="text-2xl font-bold">Employee Handbook</h1>
          <p className="text-sm text-slate-500 mt-1">Read, search, and sign the current handbook and arbitration agreement.</p>
        </header>

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className="max-w-3xl">
            <div className="mb-4 flex rounded-lg border border-slate-200 bg-white overflow-hidden w-fit print:hidden">
              {documents.map((d) => (
                <button key={d.slug} onClick={() => setActiveSlug(d.slug)} className="px-4 py-2 text-sm font-semibold transition"
                  style={activeSlug === d.slug ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
                  {d.title}
                </button>
              ))}
            </div>
            {activeDoc && <DocumentPanel doc={activeDoc} identity={identity} staff={staff} />}
          </div>
        )}
      </div>
    </main>
  );
}

export default function HandbookPage() {
  return (
    <AppIdentityGate>
      {(identity) => <HandbookPageBody identity={identity} />}
    </AppIdentityGate>
  );
}
