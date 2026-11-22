"use client";

import { Sidebar } from "@/components/Sidebar";
import ScheduleBuilder from "@/components/ScheduleBuilder";
import AppIdentityGate from "@/components/AppIdentityGate";
import AccessDenied from "@/components/AccessDenied";

function ScheduleBuilderPageInner() {
  return (
    <main className="app-shell">
      <Sidebar />
      <div className="app-content">
        <header className="mb-8">
          <h1 className="page-title">Schedule Builder</h1>
          <p className="page-subtitle">Deccan Dental — Build your monthly staffing schedule.</p>
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
