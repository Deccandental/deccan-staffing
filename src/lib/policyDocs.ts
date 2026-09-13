import { supabase } from "./supabase";

export interface PolicySection {
  heading: string;
  body: string;
  requiresInitial: boolean;
  isDivider: boolean;
}

export interface PolicyDocument {
  id: string;
  slug: string;
  title: string;
  cycleMode: "annual_september" | "sign_once_per_version";
}

export interface PolicyVersion {
  id: string;
  documentId: string;
  versionLabel: string;
  content: PolicySection[];
  active: boolean;
}

export interface PolicyRequirement {
  id: string;
  documentId: string;
  documentVersionId: string;
  cycleLabel: string;
  createdAt: string;
}

export interface PolicySignature {
  id: string;
  requirementId: string;
  employeeId: number;
  employeeName: string;
  typedName: string;
  signatureImage: string;
  initials: number[];
  signedAt: string;
  countersignedByName: string | null;
  countersignatureImage: string | null;
  countersignedAt: string | null;
}

function fromDocRow(row: any): PolicyDocument {
  return { id: row.id, slug: row.slug, title: row.title, cycleMode: row.cycle_mode };
}
function fromVersionRow(row: any): PolicyVersion {
  return { id: row.id, documentId: row.document_id, versionLabel: row.version_label, content: row.content_json, active: row.active };
}
function fromRequirementRow(row: any): PolicyRequirement {
  return { id: row.id, documentId: row.document_id, documentVersionId: row.document_version_id, cycleLabel: row.cycle_label, createdAt: row.created_at };
}
function fromSignatureRow(row: any): PolicySignature {
  return {
    id: row.id, requirementId: row.requirement_id, employeeId: row.employee_id, employeeName: row.employee_name,
    typedName: row.typed_name, signatureImage: row.signature_image, initials: row.initials_json ?? [],
    signedAt: row.signed_at, countersignedByName: row.countersigned_by_name,
    countersignatureImage: row.countersignature_image, countersignedAt: row.countersigned_at,
  };
}

export async function loadPolicyDocuments(): Promise<PolicyDocument[]> {
  const { data, error } = await supabase.from("policy_documents").select("*");
  if (error) { console.error("loadPolicyDocuments error:", error); return []; }
  return (data ?? []).map(fromDocRow);
}

export async function loadActiveVersion(documentId: string): Promise<PolicyVersion | null> {
  const { data, error } = await supabase.from("policy_document_versions").select("*")
    .eq("document_id", documentId).eq("active", true).order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("loadActiveVersion error:", error); return null; }
  return data ? fromVersionRow(data) : null;
}

export async function loadLatestRequirement(documentId: string): Promise<PolicyRequirement | null> {
  const { data, error } = await supabase.from("policy_requirements").select("*")
    .eq("document_id", documentId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("loadLatestRequirement error:", error); return null; }
  return data ? fromRequirementRow(data) : null;
}

export async function loadAllRequirements(documentId: string): Promise<PolicyRequirement[]> {
  const { data, error } = await supabase.from("policy_requirements").select("*").eq("document_id", documentId).order("created_at", { ascending: false });
  if (error) { console.error("loadAllRequirements error:", error); return []; }
  return (data ?? []).map(fromRequirementRow);
}

export async function createRequirement(documentId: string, documentVersionId: string, cycleLabel: string): Promise<PolicyRequirement | null> {
  const { data, error } = await supabase.from("policy_requirements").insert({
    document_id: documentId, document_version_id: documentVersionId, cycle_label: cycleLabel,
  }).select().single();
  if (error) { console.error("createRequirement error:", error); return null; }
  return fromRequirementRow(data);
}

export async function loadSignaturesForRequirement(requirementId: string): Promise<PolicySignature[]> {
  const { data, error } = await supabase.from("policy_signatures").select("*").eq("requirement_id", requirementId);
  if (error) { console.error("loadSignaturesForRequirement error:", error); return []; }
  return (data ?? []).map(fromSignatureRow);
}

export async function loadMySignature(requirementId: string, employeeId: number): Promise<PolicySignature | null> {
  const { data, error } = await supabase.from("policy_signatures").select("*")
    .eq("requirement_id", requirementId).eq("employee_id", employeeId).maybeSingle();
  if (error) { console.error("loadMySignature error:", error); return null; }
  return data ? fromSignatureRow(data) : null;
}

export async function submitSignature(params: {
  requirementId: string; employeeId: number; employeeName: string; typedName: string; signatureImage: string; initials: number[];
}): Promise<void> {
  const { error } = await supabase.from("policy_signatures").insert({
    requirement_id: params.requirementId, employee_id: params.employeeId, employee_name: params.employeeName,
    typed_name: params.typedName, signature_image: params.signatureImage, initials_json: params.initials,
  });
  if (error) console.error("submitSignature error:", error);
}

export async function submitCountersignature(signatureId: string, name: string, image: string): Promise<void> {
  const { error } = await supabase.from("policy_signatures").update({
    countersigned_by_name: name, countersignature_image: image, countersigned_at: new Date().toISOString(),
  }).eq("id", signatureId);
  if (error) console.error("submitCountersignature error:", error);
}

// Handbook cycle year: runs September-to-September. If today is on/after
// Sept 1 of a given year, that year is the current cycle; otherwise it's
// the previous year's cycle.
export function getCurrentSeptemberCycleYear(today: Date = new Date()): number {
  const year = today.getFullYear();
  const septFirst = new Date(year, 8, 1); // month 8 = September
  return today >= septFirst ? year : year - 1;
}

// Everyone active who hasn't signed the given requirement yet.
export async function loadPendingSigners(requirementId: string, allActiveEmployees: { id: number; name: string; email?: string }[]): Promise<{ id: number; name: string; email?: string }[]> {
  const { data, error } = await supabase.from("policy_signatures").select("employee_id").eq("requirement_id", requirementId);
  if (error) { console.error("loadPendingSigners error:", error); return allActiveEmployees; }
  const signedIds = new Set((data ?? []).map((r) => r.employee_id));
  return allActiveEmployees.filter((e) => !signedIds.has(e.id));
}

export async function getLastReminderSent(requirementId: string, employeeId: number): Promise<string | null> {
  const { data, error } = await supabase.from("policy_reminders_sent").select("sent_at").eq("requirement_id", requirementId).eq("employee_id", employeeId).maybeSingle();
  if (error) { console.error("getLastReminderSent error:", error); return null; }
  return data?.sent_at ?? null;
}

export async function recordReminderSent(requirementId: string, employeeId: number): Promise<void> {
  const { error } = await supabase.from("policy_reminders_sent").upsert({
    requirement_id: requirementId, employee_id: employeeId, sent_at: new Date().toISOString(),
  }, { onConflict: "requirement_id,employee_id" });
  if (error) console.error("recordReminderSent error:", error);
}
