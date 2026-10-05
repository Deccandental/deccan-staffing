import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, whoIs, BUCKET, MONTH_RE } from "@/lib/statementsAuth";
import { ZipBuilder } from "@/lib/zipStore";

// The month-end package for the CPA: a check register, the invoices paid, and the statement and invoice PDFs,
// built into one ZIP kept in the private bucket. Finance users only. The CPA gets an emailed link that stops
// working after 7 days; the file itself is never public.

export const runtime = "nodejs";
export const maxDuration = 120;

const LINK_SECONDS = 7 * 24 * 60 * 60;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const ADMIN_COPY = ["dr.nanjapa@mydeccandental.com", "ketki@mydeccandental.com"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const nextMonthStart = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 1)).toISOString().slice(0, 10);
const safe = (s: string) => String(s ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "file";
const money = (n: number | null | undefined) => (n == null ? "" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

// What belongs in a month's package.
async function gather(month: string) {
  const start = `${month}-01`, end = nextMonthStart(month);
  const [stm, inv, chk, outstanding, banks, cards, debts, sources] = await Promise.all([
    supabaseAdmin.from("statement_files").select("*").eq("doc_type", "statement").eq("month", month),
    supabaseAdmin.from("statement_files").select("*").eq("doc_type", "invoice").eq("paid", true).gte("paid_date", start).lt("paid_date", end).order("paid_date"),
    supabaseAdmin.from("check_register").select("*").gte("check_date", start).lt("check_date", end).order("check_date").order("check_number"),
    supabaseAdmin.from("check_register").select("amount, check_number, account_name, check_date").eq("status", "outstanding"),
    supabaseAdmin.from("cash_accounts").select("*"), supabaseAdmin.from("credit_cards").select("*"),
    supabaseAdmin.from("debts").select("*"), supabaseAdmin.from("statement_sources").select("*"),
  ]);
  const statements = (stm.data ?? []).filter((r: any) => !r.no_statement && r.file_path);
  const marked = new Set((stm.data ?? []).map((r: any) => `${r.account_kind}:${r.account_id}`));
  const expected = [
    ...(banks.data ?? []).filter((a: any) => a.active !== false).map((a: any) => ({ key: `bank:${a.id}`, name: a.name })),
    ...(cards.data ?? []).filter((c: any) => c.active !== false).map((c: any) => ({ key: `card:${c.id}`, name: c.name })),
    ...(debts.data ?? []).filter((d: any) => d.kind !== "revolving" && d.active !== false).map((d: any) => ({ key: `loan:${d.id}`, name: d.name })),
    ...(sources.data ?? []).filter((v: any) => v.active && v.expects_statement !== false && v.start_month <= month).map((v: any) => ({ key: `vendor:${v.id}`, name: v.name })),
  ];
  return {
    statements, invoices: (inv.data ?? []).filter((r: any) => r.file_path), invoicesAll: inv.data ?? [],
    checks: chk.data ?? [], outstanding: outstanding.data ?? [],
    missing: expected.filter((e) => !marked.has(e.key)).map((e) => e.name),
  };
}

function statsText(g: Awaited<ReturnType<typeof gather>>) {
  return `${g.statements.length} statement${g.statements.length === 1 ? "" : "s"}, ${g.invoicesAll.length} invoice${g.invoicesAll.length === 1 ? "" : "s"} paid, ${g.checks.length} check${g.checks.length === 1 ? "" : "s"}`;
}

async function readSetting(key: string): Promise<string> {
  const { data } = await supabaseAdmin.from("statement_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? "";
}

function summaryHtml(month: string, g: Awaited<ReturnType<typeof gather>>): string {
  const byCat: Record<string, number> = {};
  for (const i of g.invoicesAll) { const k = i.category || "Uncategorized"; byCat[k] = (byCat[k] ?? 0) + Number(i.amount ?? 0); }
  const invTotal = g.invoicesAll.reduce((n: number, i: any) => n + Number(i.amount ?? 0), 0);
  const chkTotal = g.checks.filter((c: any) => c.status !== "void").reduce((n: number, c: any) => n + Number(c.amount ?? 0), 0);
  const chkByType: Record<string, number> = {};
  for (const c of g.checks.filter((x: any) => x.status !== "void")) { const k = c.category || "Uncategorized"; chkByType[k] = (chkByType[k] ?? 0) + Number(c.amount ?? 0); }
  const outTotal = g.outstanding.reduce((n: number, c: any) => n + Number(c.amount ?? 0), 0);
  const th = "text-align:left;padding:4px 10px;border-bottom:1px solid #ddd;font-size:12px;color:#666";
  const td = "padding:4px 10px;border-bottom:1px solid #eee;font-size:13px";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Deccan Dental ${monthLabel(month)}</title></head>
<body style="font-family:Arial,sans-serif;max-width:760px;margin:24px auto;color:#222">
<h1 style="color:#e8622a;margin-bottom:0">Deccan Dental</h1><h2 style="margin-top:4px">Month-end package: ${monthLabel(month)}</h2>
<p>Prepared ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.</p>
<h3>What's included</h3>
<ul>
<li><strong>Statements/</strong>: ${g.statements.length} statement PDF${g.statements.length === 1 ? "" : "s"} covering ${monthLabel(month)}.</li>
<li><strong>Invoices/</strong>: ${g.invoices.length} invoice PDF${g.invoices.length === 1 ? "" : "s"}, for invoices paid in ${monthLabel(month)}.</li>
<li><strong>Invoices-paid.csv</strong>: ${g.invoicesAll.length} invoice${g.invoicesAll.length === 1 ? "" : "s"} paid in the month, total <strong>$${money(invTotal)}</strong>.</li>
<li><strong>Check-register.csv</strong>: ${g.checks.length} check${g.checks.length === 1 ? "" : "s"} dated in the month, total <strong>$${money(chkTotal)}</strong> (voided checks excluded from the total).</li>
</ul>
<h3>Invoices paid, by category</h3>
<table style="border-collapse:collapse;min-width:320px"><tr><th style="${th}">Category</th><th style="${th}">Amount</th></tr>
${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td style="${td}">${esc(k)}</td><td style="${td}">$${money(v)}</td></tr>`).join("") || `<tr><td style="${td}" colspan="2">None</td></tr>`}
</table>
<h3>Checks, by type</h3>
<table style="border-collapse:collapse;min-width:320px"><tr><th style="${th}">Type</th><th style="${th}">Amount</th></tr>
${Object.entries(chkByType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td style="${td}">${esc(k)}</td><td style="${td}">$${money(v)}</td></tr>`).join("") || `<tr><td style="${td}" colspan="2">None</td></tr>`}
</table>
<h3>Things to know</h3>
<ul>
<li>${g.outstanding.length} check${g.outstanding.length === 1 ? " is" : "s are"} still outstanding (not yet cleared), totalling $${money(outTotal)}.</li>
<li>${g.missing.length === 0 ? "A statement is on file for every account." : `No statement on file yet for: ${esc(g.missing.join(", "))}.`}</li>
<li>${g.invoicesAll.length - g.invoices.length > 0 ? `${g.invoicesAll.length - g.invoices.length} paid invoice(s) have no PDF attached.` : "Every paid invoice has its PDF attached."}</li>
</ul>
<p style="color:#888;font-size:12px">Generated by the Deccan Dental staff app. This file contains financial records; please store it securely.</p>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const acc = statementsAccess(req);
  if (!acc) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (acc.role !== "finance") return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  const b = await req.json().catch(() => ({}));

  try {
    if (b.action === "settings") {
      return NextResponse.json({ cpaEmail: await readSetting("cpa_email") });
    }

    if (b.action === "setCpaEmail") {
      const email = String(b.email ?? "").trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
      const { error } = await supabaseAdmin.from("statement_settings").upsert({ key: "cpa_email", value: email }, { onConflict: "key" });
      if (error) return NextResponse.json({ error: "The package tables aren't set up yet (run the month-end package SQL)." }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "list") {
      const { data, error } = await supabaseAdmin.from("statement_packages").select("*").order("created_at", { ascending: false }).limit(24);
      if (error) return NextResponse.json({ error: "The package tables aren't set up yet (run the month-end package SQL)." }, { status: 500 });
      return NextResponse.json({ packages: data ?? [] });
    }

    if (b.action === "preview") {
      if (!MONTH_RE.test(String(b.month))) return NextResponse.json({ error: "Bad month." }, { status: 400 });
      const g = await gather(b.month);
      const { count: unpaid } = await supabaseAdmin.from("statement_files").select("id", { count: "exact", head: true }).eq("doc_type", "invoice").eq("paid", false);
      return NextResponse.json({
        statements: g.statements.length, invoices: g.invoicesAll.length, invoicePdfs: g.invoices.length, checks: g.checks.length,
        invoiceTotal: g.invoicesAll.reduce((n: number, i: any) => n + Number(i.amount ?? 0), 0),
        outstanding: g.outstanding.length, missing: g.missing, unpaidInvoices: unpaid ?? 0,
      });
    }

    if (b.action === "create") {
      const month = String(b.month ?? "");
      if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Bad month." }, { status: 400 });
      const g = await gather(month);
      if (g.statements.length + g.invoicesAll.length + g.checks.length === 0) return NextResponse.json({ error: `Nothing is filed for ${monthLabel(month)} yet.` }, { status: 400 });

      const zip = new ZipBuilder();
      let total = 0;
      const used = new Set<string>();
      const unique = (folder: string, base: string) => { let name = `${folder}/${base}.pdf`, n = 2; while (used.has(name.toLowerCase())) name = `${folder}/${base} (${n++}).pdf`; used.add(name.toLowerCase()); return name; };

      const jobs = [
        ...g.statements.map((r: any) => ({ path: r.file_path as string, name: unique("Statements", `${safe(r.account_name)} - ${month}`) })),
        ...g.invoices.map((r: any) => ({ path: r.file_path as string, name: unique("Invoices", `${safe(r.account_name)} - ${safe(r.invoice_number || "no number")} - ${money(r.amount)}`) })),
      ];
      const missingFiles: string[] = [];
      for (let i = 0; i < jobs.length; i += 6) {
        const batch = jobs.slice(i, i + 6);
        const got = await Promise.all(batch.map(async (j) => {
          const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(j.path);
          if (error || !data) return null;
          return new Uint8Array(await data.arrayBuffer());
        }));
        got.forEach((bytes, k) => {
          if (!bytes) { missingFiles.push(batch[k].name); return; }
          total += bytes.length;
          if (total > MAX_TOTAL_BYTES) throw new Error("This month's files are too large for one package (over 80 MB).");
          zip.add(batch[k].name, bytes);
        });
      }

      zip.add("Invoices-paid.csv", Buffer.from(csv(
        ["Date paid", "Vendor", "Invoice #", "Invoice date", "Category", "Amount", "Paid from", "Method", "Check #", "Note"],
        g.invoicesAll.map((i: any) => [i.paid_date, i.account_name, i.invoice_number, i.invoice_date, i.category, i.amount, i.paid_from_name, i.paid_method ?? "", i.paid_check_number ?? "", i.paid_note ?? ""]),
      ), "utf8"));
      zip.add("Check-register.csv", Buffer.from(csv(
        ["Check #", "Date", "Account", "Payee", "Type", "Amount", "Memo", "Status", "Cleared date"],
        g.checks.map((c: any) => [c.check_number, c.check_date, c.account_name, c.payee, c.category ?? "", c.amount, c.memo, c.status, c.cleared_date ?? ""]),
      ), "utf8"));
      zip.add("Summary.html", Buffer.from(summaryHtml(month, g), "utf8"));
      if (missingFiles.length > 0) zip.add("Missing-files.txt", Buffer.from(`These files could not be read from storage and are not in this package:\r\n${missingFiles.join("\r\n")}\r\n`, "utf8"));

      const buf = zip.build();
      const path = `packages/${month}/Deccan-${month}-${crypto.randomUUID().slice(0, 8)}.zip`;
      const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: "application/zip", upsert: false });
      if (up.error) return NextResponse.json({ error: `Couldn't store the package: ${up.error.message} (run the month-end package SQL so the bucket accepts ZIP files).` }, { status: 500 });
      const { data, error } = await supabaseAdmin.from("statement_packages").insert({ month, file_path: path, file_size: buf.length, stats: statsText(g), created_by: whoIs(acc.session) }).select("*").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ package: data, missingFiles });
    }

    if (b.action === "download" || b.action === "email" || b.action === "delete") {
      const { data: pkg } = await supabaseAdmin.from("statement_packages").select("*").eq("id", String(b.id ?? "")).maybeSingle();
      if (!pkg) return NextResponse.json({ error: "Package not found." }, { status: 404 });
      const fileName = `Deccan-${pkg.month}-month-end-package.zip`;

      if (b.action === "download") {
        const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(pkg.file_path, 60, { download: fileName });
        if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't create the link." }, { status: 500 });
        await supabaseAdmin.from("statement_downloads").insert({ file_path: pkg.file_path, who: whoIs(acc.session), role: "finance" });
        return NextResponse.json({ url: data.signedUrl });
      }

      if (b.action === "delete") {
        await supabaseAdmin.storage.from(BUCKET).remove([pkg.file_path]);
        await supabaseAdmin.from("statement_packages").delete().eq("id", pkg.id);
        return NextResponse.json({ ok: true });
      }

      // email: a fresh link that works for 7 days
      const to = String(b.to ?? "").trim() || (await readSetting("cpa_email"));
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return NextResponse.json({ error: "Save the CPA's email address first." }, { status: 400 });
      const key = process.env.RESEND_API_KEY;
      if (!key) return NextResponse.json({ error: "Email isn't set up on the server (RESEND_API_KEY is missing)." }, { status: 500 });
      const { data: link, error: linkErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(pkg.file_path, LINK_SECONDS, { download: fileName });
      if (linkErr || !link) return NextResponse.json({ error: linkErr?.message ?? "Couldn't create the link." }, { status: 500 });
      const expires = new Date(Date.now() + LINK_SECONDS * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      const html = `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2 style="color: #e8622a;">Deccan Dental: ${esc(monthLabel(pkg.month))} month-end package</h2>
        <p>Hello,</p>
        <p>The ${esc(monthLabel(pkg.month))} records for Deccan Dental are ready: the check register, the invoices paid, and the statement and invoice PDFs (${esc(pkg.stats)}).</p>
        <p style="margin: 22px 0;"><a href="${link.signedUrl}" style="background:#e8622a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Download the package</a></p>
        <p><strong>This link stops working on ${esc(expires)}.</strong> Anyone with this email can open it until then, so please don't forward it, and save the file somewhere secure once you've downloaded it. If the link has expired, ask us to send a new one.</p>
        <p style="color:#888;font-size:13px;">Sent from the Deccan Dental staff app.</p></div>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Deccan Dental <noreply@mydeccandental.com>", to: [to], bcc: ADMIN_COPY, subject: `Deccan Dental: ${monthLabel(pkg.month)} month-end package`, html }),
      });
      if (!res.ok) return NextResponse.json({ error: "The email couldn't be sent. Check the address and the email service." }, { status: 502 });
      await supabaseAdmin.from("statement_packages").update({ emailed_to: to, emailed_at: new Date().toISOString() }).eq("id", pkg.id);
      return NextResponse.json({ ok: true, to, expires });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("statements/package error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Request failed." }, { status: 500 });
  }
}
