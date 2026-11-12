import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { adminSession } from "@/lib/reviewAuth";
import { drawNames } from "@/lib/santaDraw";
import { currentEvent, emailStaff, santaEmailHtml, SantaEvent, fmtDay } from "@/lib/santaServer";

// Running Secret Santa. Admins only.
// The organizer is usually playing too, so this route NEVER returns who drew whom
// until the organizer presses "Reveal" after the party.
export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = (v: unknown) => (DATE_RE.test(String(v ?? "")) ? String(v) : null);

async function getEvent(id: unknown): Promise<SantaEvent | null> {
  const { data } = await supabaseAdmin.from("santa_events").select("*").eq("id", String(id ?? "")).maybeSingle();
  return (data as SantaEvent) ?? null;
}

export async function POST(req: NextRequest) {
  const session = adminSession(req);
  if (!session) return NextResponse.json({ error: "Only admins can run Secret Santa." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const by = session.mode === "super" ? "Manager passcode" : (session.employeeName ?? "Admin");

  try {
    if (b.action === "state") {
      const event = await currentEvent();
      if (!event) {
        const { error } = await supabaseAdmin.from("santa_events").select("id").limit(1);
        if (error) return NextResponse.json({ error: "The Secret Santa tables aren't set up yet. Run the SQL in Supabase." }, { status: 500 });
        return NextResponse.json({ event: null });
      }
      const [{ data: people }, { data: excl }] = await Promise.all([
        supabaseAdmin.from("santa_participants").select("employee_id, employee_name, wants, avoid, gift_ready, joined_at").eq("event_id", event.id).order("employee_name"),
        supabaseAdmin.from("santa_exclusions").select("*").eq("event_id", event.id),
      ]);
      const nameOf = new Map((people ?? []).map((p: any) => [p.employee_id, p.employee_name]));
      let pairs: { giver: string; recipient: string }[] | undefined;
      if (event.status === "revealed") {
        const { data: pr } = await supabaseAdmin.from("santa_pairs").select("*").eq("event_id", event.id);
        pairs = (pr ?? []).map((p: any) => ({ giver: nameOf.get(p.giver_employee_id) ?? "?", recipient: nameOf.get(p.recipient_employee_id) ?? "?" }))
          .sort((a, c) => a.giver.localeCompare(c.giver));
      }
      return NextResponse.json({
        event,
        participants: (people ?? []).map((p: any) => ({
          employeeId: p.employee_id, name: p.employee_name,
          hasWishlist: (p.wants ?? []).length > 0, giftReady: !!p.gift_ready,
        })),
        exclusions: (excl ?? []).map((x: any) => ({ id: x.id, a: x.a_employee_id, b: x.b_employee_id, aName: nameOf.get(x.a_employee_id) ?? "?", bName: nameOf.get(x.b_employee_id) ?? "?" })),
        pairs,
      });
    }

    if (b.action === "create") {
      const existing = await currentEvent();
      if (existing) return NextResponse.json({ error: "A Secret Santa is already running. Close it before starting a new one." }, { status: 400 });
      const budget = Number(b.budget);
      const { data, error } = await supabaseAdmin.from("santa_events").insert({
        title: String(b.title ?? "").trim().slice(0, 120) || "Secret Santa",
        budget: Number.isFinite(budget) && budget > 0 ? budget : 20,
        exchange_date: dateOrNull(b.exchangeDate), wishlist_due: dateOrNull(b.wishlistDue),
        location: String(b.location ?? "").trim().slice(0, 120) || null,
        notes: String(b.notes ?? "").trim().slice(0, 600) || null,
        created_by: by,
      }).select("id").single();
      if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't create it." }, { status: 400 });
      return NextResponse.json({ id: data.id });
    }

    const event = await getEvent(b.eventId);
    if (!event) return NextResponse.json({ error: "Secret Santa not found." }, { status: 404 });

    if (b.action === "update") {
      const budget = Number(b.budget);
      const { error } = await supabaseAdmin.from("santa_events").update({
        title: String(b.title ?? "").trim().slice(0, 120) || event.title,
        budget: Number.isFinite(budget) && budget > 0 ? budget : event.budget,
        exchange_date: dateOrNull(b.exchangeDate), wishlist_due: dateOrNull(b.wishlistDue),
        location: String(b.location ?? "").trim().slice(0, 120) || null,
        notes: String(b.notes ?? "").trim().slice(0, 600) || null,
      }).eq("id", event.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "addPeople") {
      if (event.status !== "open") return NextResponse.json({ error: "Names are already drawn. Undo the draw first to add people." }, { status: 400 });
      const ids: number[] = Array.isArray(b.employeeIds) ? [...new Set<number>(b.employeeIds.map(Number).filter((n: number) => Number.isFinite(n)))] : [];
      if (ids.length === 0) return NextResponse.json({ error: "Choose someone to add." }, { status: 400 });
      const { data: staff } = await supabaseAdmin.from("staff").select("id, name, archived").in("id", ids);
      const rows = (staff ?? []).filter((s: any) => !s.archived).map((s: any) => ({ event_id: event.id, employee_id: s.id, employee_name: s.name }));
      const { error } = await supabaseAdmin.from("santa_participants").upsert(rows, { onConflict: "event_id,employee_id", ignoreDuplicates: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "removePerson") {
      if (event.status !== "open") return NextResponse.json({ error: "Names are already drawn. Undo the draw first, then remove them and draw again." }, { status: 400 });
      const id = Number(b.employeeId);
      await supabaseAdmin.from("santa_participants").delete().eq("event_id", event.id).eq("employee_id", id);
      await supabaseAdmin.from("santa_exclusions").delete().eq("event_id", event.id).or(`a_employee_id.eq.${id},b_employee_id.eq.${id}`);
      return NextResponse.json({ ok: true });
    }

    if (b.action === "addExclusion") {
      const a = Number(b.a), c = Number(b.b);
      if (!Number.isFinite(a) || !Number.isFinite(c) || a === c) return NextResponse.json({ error: "Pick two different people." }, { status: 400 });
      const { error } = await supabaseAdmin.from("santa_exclusions").insert({ event_id: event.id, a_employee_id: a, b_employee_id: c });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "removeExclusion") {
      await supabaseAdmin.from("santa_exclusions").delete().eq("id", String(b.id ?? "")).eq("event_id", event.id);
      return NextResponse.json({ ok: true });
    }

    if (b.action === "invite") {
      // Everyone active who hasn't joined yet.
      const [{ data: staff }, { data: people }] = await Promise.all([
        supabaseAdmin.from("staff").select("id, archived"),
        supabaseAdmin.from("santa_participants").select("employee_id").eq("event_id", event.id),
      ]);
      const inIds = new Set((people ?? []).map((p: any) => p.employee_id));
      const ids = (staff ?? []).filter((s: any) => !s.archived && !inIds.has(s.id)).map((s: any) => s.id);
      const res = await emailStaff(ids, (name) => ({
        subject: `Join our Secret Santa: $${Number(event.budget).toFixed(0)} max`,
        html: santaEmailHtml({ name, event, heading: event.title, button: "Count me in",
          lines: ["We're doing a Secret Santa this year. Join in the app and add a quick wishlist: 3 things you'd love and 3 things you'd rather not get."] }),
      }));
      return NextResponse.json(res);
    }

    if (b.action === "remindWishlists") {
      const { data: people } = await supabaseAdmin.from("santa_participants").select("employee_id, wants").eq("event_id", event.id);
      const ids = (people ?? []).filter((p: any) => (p.wants ?? []).length === 0).map((p: any) => p.employee_id);
      if (ids.length === 0) return NextResponse.json({ error: "Everyone has filled in a wishlist." }, { status: 400 });
      const res = await emailStaff(ids, (name) => ({
        subject: "Your Secret Santa wishlist is still empty",
        html: santaEmailHtml({ name, event, heading: "Quick reminder", button: "Fill in my wishlist",
          lines: ["Your Secret Santa will be shopping soon. Add 3 things you'd love and 3 things you'd rather not get, so they can find you something great."] }),
      }));
      return NextResponse.json(res);
    }

    if (b.action === "draw") {
      if (event.status !== "open") return NextResponse.json({ error: "Names have already been drawn." }, { status: 400 });
      const [{ data: people }, { data: excl }] = await Promise.all([
        supabaseAdmin.from("santa_participants").select("employee_id").eq("event_id", event.id),
        supabaseAdmin.from("santa_exclusions").select("a_employee_id, b_employee_id").eq("event_id", event.id),
      ]);
      const ids = (people ?? []).map((p: any) => p.employee_id as number);
      if (ids.length < 3) return NextResponse.json({ error: "You need at least 3 people to draw names." }, { status: 400 });
      const result = drawNames(ids, (excl ?? []).map((x: any) => [x.a_employee_id, x.b_employee_id] as [number, number]));
      if (!result) return NextResponse.json({ error: "The exclusions make a fair draw impossible. Remove one and try again." }, { status: 400 });
      await supabaseAdmin.from("santa_pairs").delete().eq("event_id", event.id);
      const { error } = await supabaseAdmin.from("santa_pairs").insert([...result.entries()].map(([g, r]) => ({ event_id: event.id, giver_employee_id: g, recipient_employee_id: r })));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await supabaseAdmin.from("santa_events").update({ status: "drawn", drawn_at: new Date().toISOString() }).eq("id", event.id);
      // The email says names are drawn but NOT who you got, so it's safe on a shared screen and the reveal happens in the app.
      const res = await emailStaff(ids, (name) => ({
        subject: "🎁 Secret Santa names are drawn!",
        html: santaEmailHtml({ name, event, heading: "Names are drawn!", button: "See who I got",
          lines: ["Open the app to see who you're shopping for, their wishlist, and the things they'd rather not get.",
            `Keep it to $${Number(event.budget).toFixed(0)} or less${event.exchange_date ? ` and bring it wrapped on ${fmtDay(event.exchange_date)}` : ""}. Shh, keep it a secret!`] }),
      }));
      return NextResponse.json({ ok: true, people: ids.length, ...res });
    }

    if (b.action === "undoDraw") {
      await supabaseAdmin.from("santa_pairs").delete().eq("event_id", event.id);
      await supabaseAdmin.from("santa_questions").delete().eq("event_id", event.id);
      await supabaseAdmin.from("santa_participants").update({ gift_ready: false }).eq("event_id", event.id);
      await supabaseAdmin.from("santa_events").update({ status: "open", drawn_at: null, revealed_at: null }).eq("id", event.id);
      return NextResponse.json({ ok: true });
    }

    if (b.action === "reveal") {
      if (event.status !== "drawn") return NextResponse.json({ error: "Draw names first." }, { status: 400 });
      await supabaseAdmin.from("santa_events").update({ status: "revealed", revealed_at: new Date().toISOString() }).eq("id", event.id);
      return NextResponse.json({ ok: true });
    }

    if (b.action === "close") {
      await supabaseAdmin.from("santa_events").update({ status: "closed" }).eq("id", event.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("santa/admin error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Request failed." }, { status: 500 });
  }
}
