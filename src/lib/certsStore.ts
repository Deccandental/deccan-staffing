import { supabase } from "./supabase";

export type CertOwnerType = "personnel" | "business";

export interface Certification {
  id: string;
  ownerType: CertOwnerType;
  employeeId: number | null;
  title: string;
  issuingAuthority: string;
  expirationDate: string; // YYYY-MM-DD
  fileUrl: string;
  fileName: string;
  remindersSent: Record<string, boolean>;
  createdAt: string;
}

export interface NewCertInput {
  ownerType: CertOwnerType;
  employeeId: number | null;
  title: string;
  issuingAuthority: string;
  expirationDate: string;
  fileUrl: string;
  fileName: string;
}

function fromRow(row: any): Certification {
  return {
    id: row.id,
    ownerType: row.owner_type,
    employeeId: row.employee_id ?? null,
    title: row.title,
    issuingAuthority: row.issuing_authority ?? "",
    expirationDate: row.expiration_date,
    fileUrl: row.file_url,
    fileName: row.file_name ?? "",
    remindersSent: row.reminders_sent ?? {},
    createdAt: row.created_at,
  };
}

// Uploads the file to the public "certificates" Storage bucket under a
// unique name, and returns its public URL plus the original filename for
// display. Returns null (and logs) on failure.
export async function uploadCertFile(file: File): Promise<{ url: string; name: string } | null> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext}` : ""}`;
  const { error } = await supabase.storage.from("certificates").upload(path, file);
  if (error) { console.error("uploadCertFile error:", error); return null; }
  const { data } = supabase.storage.from("certificates").getPublicUrl(path);
  return { url: data.publicUrl, name: file.name };
}

export async function loadAllCertifications(): Promise<Certification[]> {
  const { data, error } = await supabase.from("certifications").select("*").order("expiration_date");
  if (error) { console.error("loadAllCertifications error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function loadCertificationsForEmployee(employeeId: number): Promise<Certification[]> {
  const { data, error } = await supabase
    .from("certifications")
    .select("*")
    .eq("owner_type", "personnel")
    .eq("employee_id", employeeId)
    .order("expiration_date");
  if (error) { console.error("loadCertificationsForEmployee error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function createCertification(input: NewCertInput): Promise<Certification | null> {
  const { data, error } = await supabase
    .from("certifications")
    .insert({
      owner_type: input.ownerType,
      employee_id: input.employeeId,
      title: input.title,
      issuing_authority: input.issuingAuthority,
      expiration_date: input.expirationDate,
      file_url: input.fileUrl,
      file_name: input.fileName,
    })
    .select()
    .single();
  if (error) { console.error("createCertification error:", error); return null; }
  return fromRow(data);
}

export async function updateCertification(id: string, input: NewCertInput): Promise<Certification | null> {
  const { data: existing } = await supabase.from("certifications").select("expiration_date").eq("id", id).single();
  const dateChanged = existing && existing.expiration_date !== input.expirationDate;

  const update: Record<string, any> = {
    owner_type: input.ownerType,
    employee_id: input.employeeId,
    title: input.title,
    issuing_authority: input.issuingAuthority,
    expiration_date: input.expirationDate,
    file_url: input.fileUrl,
    file_name: input.fileName,
  };
  if (dateChanged) update.reminders_sent = {};

  const { data, error } = await supabase.from("certifications").update(update).eq("id", id).select().single();
  if (error) { console.error("updateCertification error:", error); return null; }
  return fromRow(data);
}

export async function deleteCertification(id: string): Promise<void> {
  const { error } = await supabase.from("certifications").delete().eq("id", id);
  if (error) console.error("deleteCertification error:", error);
}
