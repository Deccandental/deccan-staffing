"use client";

import { Sidebar } from "@/components/Sidebar";

export default function AccessDenied({ logout }: { logout: () => void }) {
  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 flex items-center justify-center min-h-screen px-4">
        <div className="rounded-2xl bg-white p-8 shadow-lg w-full max-w-sm text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="text-xl font-bold mb-1" style={{ color: "#5a5a5a" }}>No access</h1>
          <p className="text-gray-400 text-sm mb-6">You don't have permission for this area. Ask an admin, or log in with a different PIN.</p>
          <button onClick={logout} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50">
            Not you? Log out
          </button>
        </div>
      </div>
    </main>
  );
}
