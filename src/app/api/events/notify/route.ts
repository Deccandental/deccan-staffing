import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendEventEmail } from "@/lib/eventEmail";
import { StaffEvent } from "@/lib/eventsStore";

function fromRow(row: any): StaffEvent {
  return {
    id: row.id,
    date: row.date,
    time: row.time ?? "",
    endTime: row.end_time ?? "",
    title: row.title,
    description: row.description ?? "",
    mandatory: row.mandatory ?? false,
    inviteAll: row.invite_all ?? true,
    invitedStaffIds: row.invited_staff_ids ?? [],
    remind1Day: row.remind_1_day ?? true,
    remind1Week: row.remind_1_week ?? true,
    remind3Weeks: row.remind_3_weeks ?? false,
    remindersSent: row.reminders_sent ?? {},
    announced: row.announced ?? false,
    createdAt: row.created_at,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { eventId } = await req.json();
    if (!eventId) return NextResponse.json({ ok: false, error: "eventId required" }, { status: 400 });

    const { data, error } = await supabase.from("events").select("*").eq("id", eventId).single();
    if (error || !data) return NextResponse.json({ ok: false, error: "event not found" }, { status: 404 });

    const event = fromRow(data);
    const sent = await sendEventEmail(event, "announcement");
    if (sent) await supabase.from("events").update({ announced: true }).eq("id", eventId);

    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    console.error("events/notify error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
