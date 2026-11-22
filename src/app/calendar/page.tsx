import { Sidebar } from "@/components/Sidebar";
import PublicCalendar from "@/components/PublicCalendar";

export default function CalendarPage() {
  return (
    <main className="app-shell">
      <Sidebar />
      <div className="app-content">
        <header className="mb-6">
          <h1 className="page-title">Calendar</h1>
          <p className="page-subtitle">Who is working each day, including dentists, assistants, front desk, hygiene and anyone on leave.</p>
        </header>
        <PublicCalendar />
      </div>
    </main>
  );
}
