import { Sidebar } from "@/components/Sidebar";
import StaffTable from "@/components/StaffTable";

export default function StaffPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Sidebar />

      <div className="ml-64 p-8">
        <h1 className="mb-2 text-3xl font-bold">
          Staff Management
        </h1>

        <p className="mb-6 text-slate-600">
          Manage employees, roles and skills.
        </p>

        <StaffTable />
      </div>
    </main>
  );
}