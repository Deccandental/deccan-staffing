import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, whoIs, BUCKET } from "@/lib/statementsAuth";

// Gives a link to one statement that stops working after a minute, and logs who asked. Finance and CPA.
export async function POST(req: NextRequest) {
  const acc = statementsAccess(req);
  if (!acc) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const table = b.source === "check" ? "check_documents" : "statement_files";
  const { data: row } = await supabaseAdmin.from(table).select("id, file_path, file_name").eq("id", String(b.id ?? "")).maybeSingle();
  if (!row || !row.file_path) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(row.file_path, 60, { download: row.file_name || true });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't create the link." }, { status: 500 });

  await supabaseAdmin.from("statement_downloads").insert({ file_id: b.source === "check" ? null : row.id, file_path: row.file_path, who: whoIs(acc.session), role: acc.role });
  return NextResponse.json({ url: data.signedUrl });
}
