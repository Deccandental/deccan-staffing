import { Sidebar } from "@/components/Sidebar";
import ScheduleBuilder from "@/components/ScheduleBuilder";

export default function ScheduleBuilderPage() {
  return (
    <main className="min-h-screen bg-slate-100">
      <Sidebar />
      <div className="ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Schedule Builder</h1>
          <p className="mt-1 text-slate-500">Deccan Dental — Build your monthly staffing schedule step by step.</p>
        </header>
        <ScheduleBuilder />
      </div>
    </main>
  );
}
