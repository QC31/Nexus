import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  return (
    <div className="min-h-screen bg-[#100709] text-[#EEE5E6]">
      <Sidebar />

      <main className="ml-64 min-h-screen p-8">
        <Outlet />
      </main>
    </div>
  );
}
