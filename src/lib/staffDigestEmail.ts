export async function sendStaffWeeklyDigest(params: {
  employeeName: string;
  employeeEmail: string;
  items: string[];
}): Promise<boolean> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log("No RESEND_API_KEY set — staff weekly digest skipped");
    return false;
  }

  const hasItems = params.items.length > 0;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #e8622a;">Deccan Dental — Your Weekly Update</h2>
      <p>Hi ${params.employeeName},</p>
      ${hasItems ? `
        <p>Here's what needs your attention this week:</p>
        <ul>
          ${params.items.map((item) => `<li style="margin-bottom: 6px;">${item}</li>`).join("")}
        </ul>
        <p>You can take care of these in the Staff Scheduler app.</p>
      ` : `
        <p>✅ Nothing needs your attention this week — no pending certifications, signatures, or upcoming events to flag.</p>
      `}
      <p style="color: #888; font-size: 13px;">This is your one weekly summary email from the Deccan Dental staff app — certifications, policy signatures, and events are now bundled here instead of sent separately.</p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Deccan Dental <noreply@mydeccandental.com>",
        to: [params.employeeEmail],
        subject: hasItems ? "Your Weekly Update — a few things need attention" : "Your Weekly Update — all clear",
        html,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("sendStaffWeeklyDigest error:", err);
    return false;
  }
}
