import { Sidebar } from "@/components/Sidebar";
import HomeCalendar from "@/components/HomeCalendar";

export default function Home() {
  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="ml-64 p-8">
        <HomeCalendar />
      </div>
    </main>
  );
}
