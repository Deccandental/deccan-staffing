import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffSession } from "@/lib/reviewAuth";
import { cleanList } from "@/lib/santaDraw";
import { currentEvent } from "@/lib/santaServer";

// Secret Santa, from each player's side. A person only ever sees who THEY are buying for,
// never who is buying for them (until the organizer reveals it after the party).
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = staffSession(req);
  if (!session) return NextResponse.json({ error: "Log in with your own PIN to play Secret Santa." }, { status: 403 });
  const me = session.employeeId;
  const b = await req.json().catch(() => ({}));

  try {
    const event = await currentEvent();
    if (!event) {
      if (b.action === "state") return NextResponse.json({ event: null });
      return NextResponse.json({ error: "No Secret Santa is running right now." }, { status: 400 });
    }
    const { data: mine } = await supabaseAdmin.from("santa_participants").select("*").eq("event_id", event.id).eq("employee_id", me).maybeSingle();

    if (b.action === "state") {
      const { data: everyone } = await supabaseAdmin.from("santa_participants").select("employee_id, employee_name").eq("event_id", event.id).order("employee_name");
      const out: any = {
        event: {
          id: event.id, title: event.title, budget: Number(event.budget), exchangeDate: event.exchange_date, location: event.location,
          wishlistDue: event.wishlist_due, notes: event.notes, status: event.status,
        },
        players: (everyone ?? []).map((p: any) => p.employee_name),
        me: mine ? { wants: mine.wants ?? [], avoid: mine.avoid ?? [], about: mine.about ?? "", giftReady: !!mine.gift_ready } : null,
      };
      if (mine && event.status !== "open") {
        const { data: pairAsGiver } = await supabaseAdmin.from("santa_pairs").select("recipient_employee_id").eq("event_id", event.id).eq("giver_employee_id", me).maybeSingle();
        if (pairAsGiver) {
          const { data: r } = await supabaseAdmin.from("santa_participants").select("employee_name, wants, avoid, about").eq("event_id", event.id).eq("employee_id", pairAsGiver.recipient_employee_id).maybeSingle();
          const { data: asked } = await supabaseAdmin.from("santa_questions").select("id, question, answer, asked_at, answered_at").eq("event_id", event.id).eq("giver_employee_id", me).order("asked_at");
          out.giftee = r ? { name: r.employee_name, wants: r.wants ?? [], avoid: r.avoid ?? [], about: r.about ?? "", questions: asked ?? [] } : null;
        }
        // Questions sent to me by my Secret Santa. The asker's name is never sent to the browser.
        const { data: toMe } = await supabaseAdmin.from("santa_questions").select("id, question, answer, asked_at, answered_at").eq("event_id", event.id).eq("recipient_employee_id", me).order("asked_at");
        out.questionsForMe = toMe ?? [];
        if (event.status === "revealed") {
          const { data: santa } = await supabaseAdmin.from("santa_pairs").select("giver_employee_id").eq("event_id", event.id).eq("recipient_employee_id", me).maybeSingle();
          if (santa) {
            const { data: g } = await supabaseAdmin.from("santa_participants").select("employee_name").eq("event_id", event.id).eq("employee_id", santa.giver_employee_id).maybeSingle();
            out.mySanta = g?.employee_name ?? null;
          }
        }
      }
      return NextResponse.json(out);
    }

    if (b.action === "join") {
      if (event.status !== "open") return NextResponse.json({ error: "Names have already been drawn. Ask the organizer to add you." }, { status: 400 });
      if (mine) return NextResponse.json({ ok: true });
      const { error } = await supabaseAdmin.from("santa_participants").insert({ event_id: event.id, employee_id: me, employee_name: session.employeeName ?? "Staff" });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (!mine) return NextResponse.json({ error: "Join Secret Santa first." }, { status: 400 });

    if (b.action === "leave") {
      if (event.status !== "open") return NextResponse.json({ error: "Names have already been drawn. Talk to the organizer if you need to drop out." }, { status: 400 });
      await supabaseAdmin.from("santa_participants").delete().eq("id", mine.id);
      return NextResponse.json({ ok: true });
    }

    if (b.action === "saveWishlist") {
      const wants = cleanList(b.wants), avoid = cleanList(b.avoid);
      const about = String(b.about ?? "").trim().slice(0, 600);
      const { error } = await supabaseAdmin.from("santa_participants").update({ wants, avoid, about, updated_at: new Date().toISOString() }).eq("id", mine.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "giftReady") {
      await supabaseAdmin.from("santa_participants").update({ gift_ready: !!b.ready }).eq("id", mine.id);
      return NextResponse.json({ ok: true });
    }

    if (b.action === "ask") {
      if (event.status !== "drawn") return NextResponse.json({ error: "Questions open once names are drawn." }, { status: 400 });
      const question = String(b.question ?? "").trim().slice(0, 300);
      if (!question) return NextResponse.json({ error: "Type a question first." }, { status: 400 });
      const { data: pair } = await supabaseAdmin.from("santa_pairs").select("recipient_employee_id").eq("event_id", event.id).eq("giver_employee_id", me).maybeSingle();
      if (!pair) return NextResponse.json({ error: "You don't have a giftee yet." }, { status: 400 });
      const { count } = await supabaseAdmin.from("santa_questions").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("giver_employee_id", me);
      if ((count ?? 0) >= 10) return NextResponse.json({ error: "That's the limit of 10 questions." }, { status: 400 });
      const { error } = await supabaseAdmin.from("santa_questions").insert({ event_id: event.id, giver_employee_id: me, recipient_employee_id: pair.recipient_employee_id, question });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "answer") {
      const answer = String(b.answer ?? "").trim().slice(0, 500);
      if (!answer) return NextResponse.json({ error: "Type an answer first." }, { status: 400 });
      const { data, error } = await supabaseAdmin.from("santa_questions").update({ answer, answered_at: new Date().toISOString() })
        .eq("id", String(b.questionId ?? "")).eq("event_id", event.id).eq("recipient_employee_id", me).select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      if (!data || data.length === 0) return NextResponse.json({ error: "Question not found." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("santa/mine error:", err);
    return NextResponse.json({ error: "Request failed." }, { status: 500 });
  }
}
