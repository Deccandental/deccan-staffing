import { supabase } from "./supabase";

export type CertOwnerType = "personnel" | "business";

export interface Certification {
  id: string;
  ownerType: CertOwnerType;
  employeeId: number | null;
  title: string;
  expirationDate: string | null; // YYYY-MM-DD, or null if this cert never expires
  fileUrl: string;
  fileName: string;
  remindersSent: Record<string, boolean>;
  createdAt: string;
}

export interface NewCertInput {
  ownerType: CertOwnerType;
  employeeId: number | null;
  title: string;
  expirationDate: string | null;
  fileUrl: string;
  fileName: string;
}

function fromRow(row: any): Certification {
  return {
    id: row.id,
    ownerType: row.owner_type,
    employeeId: row.employee_id ?? null,
    title: row.title,
    expirationDate: row.expiration_date ?? null,
    fileUrl: row.file_url,
    fileName: row.file_name ?? "",
    remindersSent: row.reminders_sent ?? {},
    createdAt: row.created_at,
  };
}

// Distinct document names already on file, so the form can offer them as a
// dropdown instead of free text — keeps "CPR Certification" from also
// showing up as "CPR Cert" or "cpr certification" elsewhere.
export async function loadDistinctTitles(): Promise<string[]> {
  const { data, error } = await supabase.from("certifications").select("title");
  if (error) { console.error("loadDistinctTitles error:", error); return []; }
  const set = new Set<string>((data ?? []).map((r: any) => r.title).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

const MAX_FILE_SIZE_MB = 10;
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_JPEG_QUALITY = 0.8;

// Resizes an image down to MAX_IMAGE_DIMENSION on its longest edge and
// re-encodes it as a JPEG at IMAGE_JPEG_QUALITY. This is what keeps a
// full-resolution phone photo of a cert from eating up storage. If the
// browser can't decode the image (e.g. some HEIC cases), the caller falls
// back to uploading the original file untouched.
async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    if (width > height) {
      height = Math.round(height * (MAX_IMAGE_DIMENSION / width));
      width = MAX_IMAGE_DIMENSION;
    } else {
      width = Math.round(width * (MAX_IMAGE_DIMENSION / height));
      height = MAX_IMAGE_DIMENSION;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))), "image/jpeg", IMAGE_JPEG_QUALITY);
  });
  const newName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}

// Uploads the file to the public "certificates" Storage bucket under a
// unique name, and returns its public URL plus the original filename for
// display. Image files are compressed first to keep storage usage down;
// other files (PDFs, etc.) are capped at MAX_FILE_SIZE_MB instead, since
// real client-side PDF compression isn't practical here.
export async function uploadCertFile(file: File): Promise<{ url: string; name: string } | { error: string }> {
  let toUpload = file;
  const originalName = file.name;

  if (file.type.startsWith("image/")) {
    try {
      toUpload = await compressImage(file);
    } catch (err) {
      console.error("compressImage error, falling back to original file:", err);
      toUpload = file;
    }
  }

  if (toUpload.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return { error: `That file is too large (max ${MAX_FILE_SIZE_MB}MB). Please use a smaller file.` };
  }

  const ext = toUpload.name.includes(".") ? toUpload.name.split(".").pop() : "";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext}` : ""}`;
  const { error } = await supabase.storage.from("certificates").upload(path, toUpload);
  if (error) { console.error("uploadCertFile error:", error); return { error: "Upload failed. Please try again." }; }
  const { data } = supabase.storage.from("certificates").getPublicUrl(path);
  return { url: data.publicUrl, name: originalName };
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
