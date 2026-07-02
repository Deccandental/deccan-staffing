import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deccan Dental | Staff Scheduler",
  description: "Staff scheduling for Deccan Dental Sleep Center",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: "#f5f5f5", color: "#5a5a5a" }} className="antialiased">
        {children}
      </body>
    </html>
  );
}
