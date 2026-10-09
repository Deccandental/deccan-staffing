import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySessionToken, SessionPayload } from "@/lib/session";

const BUCKET = "setups";
const MAX_BYTES = 12 * 1024 * 1024;
const COLS = "id, title, group_name, file_path, items, sort_order, created_at";

// Anyone logged in as staff (or the manager passcode) can view. Only admins change anything.
function who(req: NextRequest): { session: SessionPayload; admin: boolean } | null {
  const session = verifySessionToken(req.headers.get("x-session-token"));
  if (!session || session.mode === "cpa") return null;
  return { session, admin: session.mode === "super" || !!session.canAdmin };
}

function cleanItems(raw: unknown): { text: string; x: number | null; y: number | null }[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
  return raw.slice(0, 100).map((i: any) => ({ text: String(i?.text ?? "").slice(0, 200), x: num(i?.x), y: num(i?.y) }));
}

export async function POST(req: NextRequest) {
  const w = who(req);
  if (!w) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const b = await req.json().catch(() => ({}));

  try {
    if (b.action === "list") {
      const { data, error } = await supabaseAdmin.from("setups").select(COLS).order("group_name").order("sort_order").order("created_at");
      if (error) return NextResponse.json({ error: "Set-ups aren't set up yet (run the set-ups SQL)." }, { status: 500 });
      const rows = (data ?? []) as any[];
      // Photos are private; each gets a link that works for an hour.
      const urls: Record<string, string> = {};
      if (rows.length > 0) {
        const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.file_path), 3600);
        for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
      }
      return NextResponse.json({
        admin: w.admin,
        setups: rows.map((r) => ({ id: r.id, title: r.title, group: r.group_name, items: r.items ?? [], url: urls[r.file_path] ?? "" })),
      });
    }

    if (!w.admin) return NextResponse.json({ error: "Only admins can change set-ups." }, { status: 403 });

    if (b.action === "uploadSlot") {
      if (!(Number(b.size) > 0) || Number(b.size) > MAX_BYTES) return NextResponse.json({ error: "Photo is too large (12 MB limit)." }, { status: 400 });
      const ext = String(b.contentType) === "image/png" ? "png" : String(b.contentType) === "image/webp" ? "webp" : "jpg";
      const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't start the upload." }, { status: 500 });
      return NextResponse.json({ path, token: data.token });
    }

    if (b.action === "create") {
      const title = String(b.title ?? "").trim().slice(0, 120);
      const path = String(b.path ?? "");
      if (!title) return NextResponse.json({ error: "Enter a title." }, { status: 400 });
      if (!/^\d{4}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
      const dir = path.slice(0, path.lastIndexOf("/")), base = path.slice(path.lastIndexOf("/") + 1);
      const { data: found } = await supabaseAdmin.storage.from(BUCKET).list(dir, { search: base });
      if (!found || !found.some((f) => f.name === base)) return NextResponse.json({ error: "The upload didn't complete. Please try again." }, { status: 400 });
      const { error } = await supabaseAdmin.from("setups").insert({
        title, group_name: String(b.group ?? "").trim().slice(0, 60), file_path: path, items: [], created_by: w.session.employeeName ?? "Manager",
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "update") {
      const patch: Record<string, unknown> = {};
      if (typeof b.title === "string") { if (!b.title.trim()) return NextResponse.json({ error: "Enter a title." }, { status: 400 }); patch.title = b.title.trim().slice(0, 120); }
      if (typeof b.group === "string") patch.group_name = b.group.trim().slice(0, 60);
      if (b.items !== undefined) patch.items = cleanItems(b.items);
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
      const { error } = await supabaseAdmin.from("setups").update(patch).eq("id", String(b.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "delete") {
      const { data: row } = await supabaseAdmin.from("setups").select("file_path").eq("id", String(b.id)).maybeSingle();
      if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
      await supabaseAdmin.storage.from(BUCKET).remove([row.file_path]);
      const { error } = await supabaseAdmin.from("setups").delete().eq("id", String(b.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  } catch (err: any) {
    console.error("setups error:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
