import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, BUCKET, MAX_BYTES, KINDS, MONTH_RE, slug } from "@/lib/statementsAuth";

// Hands the browser a one-time upload slot in the private bucket. Only finance users get one.
export async function POST(req: NextRequest) {
  const acc = statementsAccess(req);
  if (!acc) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (acc.role !== "finance") return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const b = await req.json().catch(() => ({}));

  // A supporting document for a check on the register.
  if (b.docType === "check") {
    const checkId = String(b.checkId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(checkId)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const name = String(b.fileName ?? "");
    if (!/\.pdf$/i.test(name)) return NextResponse.json({ error: "Only PDF files can be uploaded." }, { status: 400 });
    if (!(Number(b.size) > 0) || Number(b.size) > MAX_BYTES) return NextResponse.json({ error: "File is too large (15 MB limit)." }, { status: 400 });
    const path = `checks/${checkId}/${slug(name.replace(/\.pdf$/i, ""))}-${crypto.randomUUID().slice(0, 8)}.pdf`;
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't start the upload." }, { status: 500 });
    return NextResponse.json({ path, token: data.token });
  }
  if (!KINDS.has(b.accountKind) || !MONTH_RE.test(String(b.month)) || !b.accountName) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const fileName = String(b.fileName ?? "");
  if (!/\.pdf$/i.test(fileName)) return NextResponse.json({ error: "Only PDF files can be uploaded." }, { status: 400 });
  if (!(Number(b.size) > 0) || Number(b.size) > MAX_BYTES) return NextResponse.json({ error: "File is too large (15 MB limit)." }, { status: 400 });

  const month = String(b.month);
  const folder = b.docType === "invoice" ? "invoices/" : "";
  const path = `${folder}${month.slice(0, 4)}/${month}/${slug(String(b.accountName))}-${crypto.randomUUID().slice(0, 8)}.pdf`;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't start the upload." }, { status: 500 });
  return NextResponse.json({ path, token: data.token });
}
