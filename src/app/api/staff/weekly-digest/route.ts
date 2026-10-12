import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendStaffWeeklyDigest } from "@/lib/staffDigestEmail";
import { loadAllSlots, computeCheckinStatus } from "@/lib/checkinsStore";
import { computeRequiredCertStatuses, type RequiredCertRole, type RequiredCertType, type CeCourseEntry } from "@/lib/requiredCertsStore";

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

function addMonthsStr(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}


function mapTypeRow(row: any): RequiredCertType {
  return {
    id: row.id, title: row.title, appliesToRole: row.applies_to_role,
    kind: row.kind, frequencyMonths: row.frequency_months, sortOrder: row.sort_order ?? 0,
    targetHours: row.target_hours ?? null, dateMode: row.date_mode ?? "expiration",
  };
}

function mapCeRow(row: any): CeCourseEntry {
  return {
    id: row.id, employeeId: row.employee_id, requiredCertTypeId: row.required_cert_type_id,
    courseName: row.course_name, hours: row.hours, dateCompleted: row.date_completed,
  };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("CRON_SECRET is not set — /api/staff/weekly-digest is unauthenticated");
  }

  const [{ data: staffRows }, { data: certRows }, { data: docs }, { data: eventRows }, checkinSlots] = await Promise.all([
    // Role and specialty are needed to work out which requirements apply to
    // each person; all certifications (not just dated ones) are needed to
    // tell "never provided" apart from "expiring".
    supabase.from("staff").select("id, name, email, role, specialty, archived, exempt_from_policy_signing, exempt_from_checkin").eq("archived", false),
    supabase.from("certifications").select("*"),
    supabase.from("policy_documents").select("*"),
    supabase.from("events").select("*"),
    loadAllSlots(),
  ]);
  // RSVP answers so far, so the digest can nudge only the people who
  // haven't replied yet rather than pestering everyone.
  const { data: rsvpRows } = await supabase.from("event_rsvps").select("event_id, employee_id");
  // Required certificate/CE types, plus every logged CE course, so the
  // digest can flag what's missing entirely — not only what's expiring.
  const [{ data: requiredTypeRows }, { data: ceEntryRows }] = await Promise.all([
    supabase.from("required_cert_types").select("*"),
    supabase.from("ce_course_entries").select("*"),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  const docRequirements: { docTitle: string; requirementId: string; cycleLabel: string; signedIds: Set<number>; restrictedToEmployeeId: number | null }[] = [];
  for (const doc of docs ?? []) {
    const { data: req } = await supabase.from("policy_requirements").select("*")
      .eq("document_id", doc.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!req) continue;
    const { data: sigs } = await supabase.from("policy_signatures").select("employee_id").eq("requirement_id", req.id);
    docRequirements.push({
      docTitle: doc.title, requirementId: req.id, cycleLabel: req.cycle_label,
      signedIds: new Set((sigs ?? []).map((s) => s.employee_id)), restrictedToEmployeeId: doc.restricted_to_employee_id ?? null,
    });
  }

  const results: { employeeId: number; itemCount: number; sent: boolean }[] = [];

  for (const emp of staffRows ?? []) {
    if (!emp.email) continue;
    const items: string[] = [];

    const myCerts = (certRows ?? []).filter((c) => c.employee_id === emp.id);

    for (const cert of myCerts) {
      if (!cert.expiration_date) continue;
      const remaining = daysUntil(cert.expiration_date);
      if (remaining < 0) items.push(`<strong>Certification expired:</strong> ${cert.title} (expired ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"} ago)`);
      else if (remaining <= 60) items.push(`<strong>Certification expiring:</strong> ${cert.title} — ${remaining} day${remaining === 1 ? "" : "s"} left`);
    }

    // Requirements with nothing on file at all. Previously invisible here,
    // because the digest only looked at certificates that already existed —
    // so someone who had never submitted their BLS/CPR was never told.
    const myRoles: string[] = [];
    if (emp.role === "Dentist") {
      myRoles.push("Dentist");
      if (emp.specialty && emp.specialty !== "General Dentist") myRoles.push("Specialist");
    }
    if (emp.role === "RDA") myRoles.push("RDA");
    if (emp.role === "Hygienist") myRoles.push("Hygienist");
    if (emp.role === "Assistant") myRoles.push("Assistant");

    const seenTitles = new Set<string>();
    const myRequirements = (requiredTypeRows ?? [])
      .filter((t) => myRoles.includes(t.applies_to_role))
      .filter((t) => { if (seenTitles.has(t.title)) return false; seenTitles.add(t.title); return true; });

    // The licence anchors every CE renewal window, so find its expiry once.
    const licenseType = myRequirements.find((t) => t.kind === "license");
    const licenseExpiration = licenseType
      ? myCerts.find((c) => c.title === licenseType.title)?.expiration_date ?? null
      : null;
    const daysToRenewal = licenseExpiration ? daysUntil(licenseExpiration) : null;

    for (const req of myRequirements) {
      const isCertKind = req.kind === "license" || req.kind === "standalone";
      if (isCertKind) {
        const onFile = myCerts.some((c) => c.title === req.title);
        if (!onFile) items.push(`<strong>Certificate missing:</strong> ${req.title} — nothing on file yet`);
      }
    }

    // CE requirements only get raised once the renewal is close enough to
    // matter. Flagging them a year or more out would be noise every week.
    // The numbers come from the same function the Staff Dashboard uses, so
    // the email and the dashboard always agree. All CE items are gathered
    // under one heading rather than one bullet each.
    if (daysToRenewal != null && daysToRenewal >= 0 && daysToRenewal <= 183) {
      const statuses = computeRequiredCertStatuses(
        myRoles as RequiredCertRole[],
        (requiredTypeRows ?? []).map(mapTypeRow),
        myCerts.map((c) => ({ title: c.title, expirationDate: c.expiration_date ?? null, ceHours: c.ce_hours ?? null, createdAt: c.created_at ?? "" })),
        (ceEntryRows ?? []).filter((e) => e.employee_id === emp.id).map(mapCeRow),
        today
      );
      const renews = new Date(licenseExpiration! + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      const ceLines: string[] = [];
      for (const st of statuses) {
        const k = st.type.kind;
        if (k !== "total_ce_hours" && k !== "ce_hours" && k !== "one_time_ce") continue;
        if (st.satisfied || st.missingLicense) continue;
        if (k === "total_ce_hours") {
          const target = st.targetHours ?? 0;
          const left = Math.round((target - st.totalHoursInWindow) * 100) / 100;
          ceLines.push(`<strong>${st.type.title}:</strong> ${left} of ${target} hrs still needed (${Math.round(st.totalHoursInWindow * 100) / 100} logged)`);
        } else if (k === "one_time_ce") {
          ceLines.push(`<strong>${st.type.title}:</strong> not yet completed`);
        } else {
          ceLines.push(`<strong>${st.type.title}:</strong> none logged for this renewal period`);
        }
      }
      if (ceLines.length > 0) {
        items.push(`<strong>Continuing education (CE) — your licence renews on ${renews} (${daysToRenewal} day${daysToRenewal === 1 ? "" : "s"}):</strong><ul style="margin: 6px 0 0 0; padding-left: 20px;">${ceLines.map((l) => `<li style="margin-bottom: 4px;">${l}</li>`).join("")}</ul>`);
      }
    }

    if (!emp.exempt_from_policy_signing) {
      for (const dr of docRequirements) {
        if (dr.restrictedToEmployeeId != null && dr.restrictedToEmployeeId !== emp.id) continue;
        if (!dr.signedIds.has(emp.id)) items.push(`<strong>Signature needed:</strong> ${dr.docTitle} (${dr.cycleLabel})`);
      }
    }

    for (const ev of eventRows ?? []) {
      const invited = ev.invite_all || (ev.invited_staff_ids ?? []).includes(emp.id);
      if (!invited) continue;
      const remaining = daysUntil(ev.date);
      if (remaining >= 0 && remaining <= 21) {
        items.push(`<strong>${ev.mandatory ? "Mandatory event" : "Event"}:</strong> ${ev.title} on ${new Date(ev.date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}`);
        // Only nudge if this event asks for an RSVP and this person hasn't
        // answered yet — someone who already replied needs no reminder.
        if (ev.rsvp_enabled) {
          const answered = (rsvpRows ?? []).some((r) => r.event_id === ev.id && r.employee_id === emp.id);
          if (!answered) {
            items.push(`<strong>RSVP needed:</strong> let us know if you're attending ${ev.title} — answer on your Staff Dashboard`);
          }
        }
      }
    }

    if (!emp.exempt_from_checkin) {
      const checkinStatus = computeCheckinStatus(emp.id, checkinSlots, today);
      if (checkinStatus.upcomingSlot) {
        items.push(`<strong>Check-in scheduled:</strong> ${new Date(checkinStatus.upcomingSlot.date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })} at ${checkinStatus.upcomingSlot.time}`);
      } else if (checkinStatus.isDue) {
        items.push(`<strong>Check-in due:</strong> ${checkinStatus.lastCompletedDate ? "please schedule your next 6-month check-in" : "please schedule your first check-in"} — pick a slot on the Check-Ins page`);
      }
    }

    const sent = await sendStaffWeeklyDigest({ employeeName: emp.name, employeeEmail: emp.email, items });
    results.push({ employeeId: emp.id, itemCount: items.length, sent });
  }

  return NextResponse.json({ ok: true, results });
}
