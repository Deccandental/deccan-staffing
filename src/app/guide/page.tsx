// How-To / user manual for the Deccan Sleep app.
// Static content page — lives under the app shell at /guide.

const ORANGE = "#e8622a";
const HEADING = "#5a5a5a";

function Section({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: "1rem",
        borderTop: `3px solid ${ORANGE}`,
        padding: "1.25rem 1.5rem",
      }}
    >
      <h2
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          fontSize: "1.125rem",
          fontWeight: 800,
          color: HEADING,
          margin: 0,
        }}
      >
        <span style={{ fontSize: "1.35rem" }}>{icon}</span>
        {title}
      </h2>
      <div style={{ marginTop: "0.75rem", fontSize: "0.9375rem", color: "#475569", lineHeight: 1.6 }}>
        {children}
      </div>
    </div>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: HEADING }}>{children}</strong>;
}

export default function GuidePage() {
  return (
    <div style={{ maxWidth: 780, margin: "0 auto", paddingBottom: "3rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.875rem", fontWeight: 800, color: HEADING, margin: 0 }}>
          How to Use This App
        </h1>
        <p style={{ marginTop: "0.5rem", color: "#64748b", fontSize: "1rem", lineHeight: 1.6 }}>
          A guide to tracking sleep-appliance patients from intake through follow-up — treatment
          progress, insurance claims, appointments, and referral letters, all in one place.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Section icon="🎯" title="What this app is for">
          <p style={{ margin: 0 }}>
            This is a patient tracker for oral appliance therapy. For each patient you can see at a
            glance where they are in <Term>treatment</Term> and where their <Term>insurance claim</Term>{" "}
            stands, who referred them, their appliance and lab details, scheduled visits, and the
            physician letters you&apos;ve sent. It keeps only minimal identifying information —
            first name and last initial — by design.
          </p>
        </Section>

        <Section icon="🏠" title="The dashboard (patient list)">
          <p style={{ marginTop: 0 }}>
            The home screen lists every patient. From here you can:
          </p>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            <li><Term>Search</Term> by initials and <Term>sort</Term> by name, severity, treatment, insurance, or physician.</li>
            <li>Spot Open&nbsp;Dental-linked patients instantly — their initials circle is{" "}
              <span style={{ color: "#16a34a", fontWeight: 700 }}>green</span> instead of orange.</li>
            <li>Open a patient by clicking their card, or add a new one with <Term>+ New Patient</Term>.</li>
          </ul>
        </Section>

        <Section icon="🌳" title="The patient page — reading it at a glance">
          <p style={{ marginTop: 0 }}>
            The top of every patient page shows two progress tracks side by side:
          </p>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            <li><Term>Treatment</Term> (orange) — Intake → Records → Fabrication → Delivery → the follow-ups → Complete.</li>
            <li><Term>Insurance / Claim</Term> (indigo) — Benefit Check → Pre-Auth → Claim Filed → Claim Complete.</li>
          </ul>
          <p style={{ marginBottom: 0 }}>
            Each step shows a <Term>✓ with a date</Term> when done, a highlighted ring for the{" "}
            <Term>current</Term> step, or grey for upcoming. Tap any step to jump down to where you
            edit it. The six colored cards above the tracks are the quick summary (severity, status,
            fee, physician, next visit).
          </p>
        </Section>

        <Section icon="📅" title="Scheduling & tracking visits">
          <p style={{ marginTop: 0 }}>
            The <Term>Visits</Term> block lists upcoming visits with their dates.
          </p>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            <li><Term>Set next appointment</Term> — pick the visit type and a date to schedule it.</li>
            <li>Give it a <Term>past date</Term> and it&apos;s logged as an already-completed visit — handy for entering history on patients who&apos;ve already been through treatment.</li>
            <li><Term>Mark done</Term> on a visit checks it off — and its matching step lights up on the treatment track.</li>
            <li>On a 1-day or 1-week follow-up, <Term>Open form ↗</Term> launches that call&apos;s questionnaire.</li>
          </ul>
        </Section>

        <Section icon="📊" title="Setting status & severity">
          <p style={{ marginTop: 0 }}>
            In the <Term>Treatment Status</Term> and <Term>Insurance Status</Term> sections, click a
            stage to set it — earlier stages fill in as done automatically, and each change is dated.
          </p>
          <p style={{ marginBottom: 0 }}>
            <Term>Severity</Term> lets you mark Mild, Moderate, or Severe (OSA) — or{" "}
            <span style={{ color: "#0369a1", fontWeight: 700 }}>Snoring</span> for patients getting a
            device for snoring rather than sleep apnea. Click again to clear it.
          </p>
        </Section>

        <Section icon="🦷" title="Appliance, lab & advancement">
          <p style={{ margin: 0 }}>
            Record the <Term>lab</Term>, <Term>appliance</Term>, and <Term>PDAC code</Term> (suggestions
            pull from your Labs &amp; Appliances list), and log each titration on the{" "}
            <Term>Advancement Timeline</Term> so you can see the appliance&apos;s progression toward
            its therapeutic position.
          </p>
        </Section>

        <Section icon="✅" title="The Appointments section (task checklists)">
          <p style={{ margin: 0 }}>
            Below the summary, the <Term>Appointments</Term> section is where each visit carries its
            own <Term>task checklist</Term> (the clinical and admin to-dos). Click a visit to open its
            tasks, add or reorder visits, or edit dates. This is the full workbench; the Visits block
            up top is the quick view.
          </p>
        </Section>

        <Section icon="📞" title="Follow-up call questionnaires">
          <p style={{ marginTop: 0 }}>
            The <Term>1-Day</Term> and <Term>1-Week</Term> follow-up forms are for use during the
            call. Fill in the patient&apos;s answers, then <Term>Save as PDF</Term> — a print-ready
            copy opens so you can save it to the patient&apos;s chart.
          </p>
          <p style={{ marginBottom: 0 }}>
            Nothing from these forms is stored in the app — the PDF is the record. (Allow pop-ups the
            first time so the PDF can open.)
          </p>
        </Section>

        <Section icon="✉️" title="Physician letters">
          <p style={{ margin: 0 }}>
            The <Term>Letters</Term> section generates referral letters to the patient&apos;s physician
            (post-delivery and calibration-complete). A reminder banner appears at the top of the page
            until you&apos;ve marked the post-delivery letter as sent.
          </p>
        </Section>

        <Section icon="🔗" title="Open Dental integration">
          <p style={{ marginTop: 0 }}>
            From inside Open&nbsp;Dental, the <Term>SleepApp</Term> toolbar button opens this app
            straight to the patient you&apos;re viewing.
          </p>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            <li>The <Term>first time</Term> you click through for a patient, you&apos;ll link them to their sleep record (or create a new one). After that, it jumps straight there.</li>
            <li>Once linked, that patient shows a <span style={{ color: "#16a34a", fontWeight: 700 }}>green</span> initials circle on the dashboard.</li>
          </ul>
        </Section>

        <Section icon="🔒" title="Locking the app">
          <p style={{ margin: 0 }}>
            Use the <Term>lock</Term> button at the bottom of the sidebar to end your session — the app
            is passcode-protected, so anyone opening it next will need the code.
          </p>
        </Section>
      </div>
    </div>
  );
}
