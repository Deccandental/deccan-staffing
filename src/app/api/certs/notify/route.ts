import { NextRequest, NextResponse } from "next/server";
import { sessionFrom, hasPerm } from "@/lib/routeAuth";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { sendCertEmail } from "@/lib/certEmail";
import { Certification } from "@/lib/certsStore";

function fromRow(row: any): Certification {
  return {
    id: row.id,
    ownerType: row.owner_type,
    employeeId: row.employee_id ?? null,
    title: row.title,
    expirationDate: row.expiration_date ?? null,
    ceHours: row.ce_hours ?? null,
    fileUrl: row.file_url,
    fileName: row.file_name ?? "",
    remindersSent: row.reminders_sent ?? {},
    createdAt: row.created_at,
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = sessionFrom(req);
    if (!session) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { certId } = await req.json();
    if (!certId) return NextResponse.json({ ok: false, error: "certId required" }, { status: 400 });

    const { data, error } = await supabase.from("certifications").select("*").eq("id", certId).single();
    if (error || !data) return NextResponse.json({ ok: false, error: "certification not found" }, { status: 404 });

    // Certificate managers, or the person the certificate belongs to.
    if (!hasPerm(session, "certs") && !(session.mode === "staff" && session.employeeId === data.employee_id)) {
      return NextResponse.json({ ok: false, error: "Not permitted." }, { status: 403 });
    }
    const cert = fromRow(data);
    const sent = await sendCertEmail(cert, "manual");
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    console.error("certs/notify error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
