const ADMIN_RECIPIENTS = ["dr.nanjapa@mydeccandental.com", "ketki@mydeccandental.com", "dr.coulter@mydeccandental.com"];

export async function sendPolicySignReminder(params: {
  employeeName: string;
  employeeEmail?: string;
  documentTitle: string;
  cycleLabel: string;
  isNewCycle: boolean;
}): Promise<boolean> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log("No RESEND_API_KEY set — policy reminder email skipped");
    return false;
  }
  if (!params.employeeEmail) return false;

  const subject = params.isNewCycle
    ? `Action required: sign the ${params.documentTitle} (${params.cycleLabel})`
    : `Reminder: your signature is still needed — ${params.documentTitle}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #e8622a;">Deccan Dental</h2>
      <p>Hi ${params.employeeName},</p>
      <p>${params.isNewCycle
        ? `A new signing cycle has started for the <strong>${params.documentTitle}</strong> (${params.cycleLabel}). Please review and sign it at your earliest convenience.`
        : `This is a reminder that your signature is still needed for the <strong>${params.documentTitle}</strong> (${params.cycleLabel}).`}</p>
      <p>You can read, search, and sign it directly in the Staff Scheduler app under <strong>Handbook</strong> in the sidebar.</p>
      <p style="color: #888; font-size: 13px;">This is an automated reminder from the Deccan Dental staff app.</p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Deccan Dental <noreply@mydeccandental.com>",
        to: [params.employeeEmail],
        bcc: ADMIN_RECIPIENTS,
        subject,
        html,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("sendPolicySignReminder error:", err);
    return false;
  }
}
