import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendCertEmail } from "@/lib/certEmail";
import { Certification } from "@/lib/certsStore";

function fromRow(row: any): Certification {
  return {
    id: row.id,
    ownerType: row.owner_type,
    employeeId: row.employee_id ?? null,
    title: row.title,
    issuingAuthority: row.issuing_authority ?? "",
    expirationDate: row.expiration_date,
    fileUrl: row.file_url,
    fileName: row.file_name ?? "",
    remindersSent: row.reminders_sent ?? {},
    createdAt: row.created_at,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { certId } = await req.json();
    if (!certId) return NextResponse.json({ ok: false, error: "certId required" }, { status: 400 });

    const { data, error } = await supabase.from("certifications").select("*").eq("id", certId).single();
    if (error || !data) return NextResponse.json({ ok: false, error: "certification not found" }, { status: 404 });

    const cert = fromRow(data);
    const sent = await sendCertEmail(cert, "manual");
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    console.error("certs/notify error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
