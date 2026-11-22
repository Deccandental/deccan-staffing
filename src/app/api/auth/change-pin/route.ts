import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySessionToken } from "@/lib/session";
import { pinProblem, PIN_TAKEN } from "@/lib/pinRules";

// Lets a logged-in staff member replace their own PIN. They must type the
// current one, so someone using an unattended logged-in screen can't change it.
export async function POST(req: NextRequest) {
  const session = verifySessionToken(req.headers.get("x-session-token"));
  if (!session || session.mode !== "staff" || session.employeeId == null) {
    return NextResponse.json({ error: "Please log in with your own PIN first." }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Malformed request." }, { status: 400 }); }
  const currentPin = String(body.currentPin ?? "");
  const newPin = String(body.newPin ?? "");

  const { data: me, error } = await supabaseAdmin.from("staff").select("id, pin").eq("id", session.employeeId).eq("archived", false).maybeSingle();
  if (error || !me) return NextResponse.json({ error: "Couldn't find your staff record." }, { status: 404 });
  if (!currentPin || me.pin !== currentPin) return NextResponse.json({ error: "Your current PIN isn't right." }, { status: 403 });

  // "That PIN is taken" tells the person someone else has it, so cap how
  // often anyone can hit that answer — otherwise it could be used to hunt
  // for other people's PINs.
  const probeKey = `pin-taken:${me.id}`;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await supabaseAdmin.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", probeKey).gte("at", since);
  if ((count ?? 0) >= 5) return NextResponse.json({ error: "Too many attempts today. Please ask a manager to set your PIN." }, { status: 429 });

  const problem = await pinProblem(newPin, me.id);
  if (problem === PIN_TAKEN) await supabaseAdmin.from("login_attempts").insert({ ip: probeKey });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const { error: upErr } = await supabaseAdmin.from("staff").update({ pin: newPin }).eq("id", me.id);
  if (upErr) return NextResponse.json({ error: "Couldn't save the new PIN. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
