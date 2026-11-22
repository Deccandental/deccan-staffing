import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySessionToken } from "@/lib/session";

// Hands a logged-in person a one-time signed upload slot in the Certificates
// bucket. The bucket no longer accepts uploads from the public key, so this
// is the only way a certificate file gets in.
const MAX_BYTES = 10 * 1024 * 1024;
const EXT = /^[a-z0-9]{1,5}$/;

export async function POST(req: NextRequest) {
  const session = verifySessionToken(req.headers.get("x-session-token"));
  if (!session || session.mode === "cpa") return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Malformed request." }, { status: 400 }); }
  const size = Number(body.size);
  if (!(size > 0) || size > MAX_BYTES) return NextResponse.json({ error: "That file is too large." }, { status: 400 });
  const ext = String(body.ext ?? "").toLowerCase();

  const path = `${Date.now()}-${crypto.randomUUID()}${EXT.test(ext) ? `.${ext}` : ""}`;
  const { data, error } = await supabaseAdmin.storage.from("Certificates").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Couldn't start the upload." }, { status: 500 });
  const { data: pub } = supabaseAdmin.storage.from("Certificates").getPublicUrl(path);
  return NextResponse.json({ path, token: data.token, publicUrl: pub.publicUrl });
}
