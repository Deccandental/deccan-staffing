const ADMIN_RECIPIENTS = ["dr.nanjapa@mydeccandental.com", "ketki@mydeccandental.com"];

export async function sendWeeklyCashDigest(items: string[]): Promise<boolean> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log("No RESEND_API_KEY set — weekly cash digest skipped");
    return false;
  }
  if (items.length === 0) return true; // nothing to report, don't send an empty email

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #e8622a;">Deccan Dental — Weekly Cash Flow Update</h2>
      <p>Good morning! Before this week's Friday cash review, here's what needs updating:</p>
      <ul>
        ${items.map((item) => `<li style="margin-bottom: 6px;">${item}</li>`).join("")}
      </ul>
      <p>Update these in the Cash Flow section of the Staff Scheduler app.</p>
      <p style="color: #888; font-size: 13px;">This is an automated weekly reminder from the Deccan Dental staff app.</p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Deccan Dental <noreply@mydeccandental.com>",
        to: ADMIN_RECIPIENTS,
        subject: "Weekly Cash Flow Update — items needing attention",
        html,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("sendWeeklyCashDigest error:", err);
    return false;
  }
}
