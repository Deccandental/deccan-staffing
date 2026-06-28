import { Sidebar } from "@/components/Sidebar";
import { StaffingDashboard } from "@/components/StaffingDashboard";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen">
        <Sidebar />

        <section className="ml-64 flex-1 p-4 sm:p-6 lg:p-8">
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-6 lg:p-8">
            <StaffingDashboard />
          </div>
        </section>
      </div>
    </main>
  );
}

