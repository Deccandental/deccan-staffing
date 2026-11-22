"use client";

import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate from "@/components/AppIdentityGate";
import ChangePinForm from "@/components/ChangePinForm";

export default function ChangePinPage() {
  const router = useRouter();
  return (
    <AppIdentityGate>
      {(identity) => (
        <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
          <Sidebar />
          <div className="pt-16 lg:pt-0 lg:ml-64 flex items-center justify-center min-h-screen px-4">
            <div className="rounded-2xl bg-white p-6 sm:p-10 shadow-lg w-full max-w-sm">
              <div className="text-5xl mb-4 text-center">🔑</div>
              <h1 className="text-2xl font-bold mb-1 text-center" style={{ color: "#5a5a5a" }}>Change my PIN</h1>
              {identity.mode === "staff" ? (
                <ChangePinForm
                  intro="Enter your current PIN, then choose a new 6-digit one. Don't share it with anyone."
                  onDone={() => router.push("/staff-dashboard")}
                />
              ) : (
                <p className="text-gray-500 text-sm text-center mt-4">
                  You're logged in with the master passcode. That's changed in the app's server settings (SUPER_PASSCODE), not here. Staff PINs are set on the Staff page.
                </p>
              )}
            </div>
          </div>
        </main>
      )}
    </AppIdentityGate>
  );
}
