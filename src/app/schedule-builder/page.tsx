import { Sidebar } from "@/components/Sidebar";
import ScheduleBuilder from "@/components/ScheduleBuilder";
import AppIdentityGate from "@/components/AppIdentityGate";
import AccessDenied from "@/components/AccessDenied";

function ScheduleBuilderPageInner() {
  return (
    <main className="min-h-screen bg-slate-100">
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Schedule Builder</h1>
          <p className="mt-1 text-slate-500">Deccan Dental — Build your monthly staffing schedule.</p>
        </header>
        <ScheduleBuilder />
      </div>
    </main>
  );
}

export default function ScheduleBuilderPage() {
  return (
    <AppIdentityGate>
      {(identity, logout) => identity.canAdmin ? <ScheduleBuilderPageInner /> : <AccessDenied logout={logout} />}
    </AppIdentityGate>
  );
}
