import { SidebarNav } from "./SidebarNav";

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 w-64 border-r border-[#3B171D] bg-[#170A0D]">
      <div className="border-b border-[#3B171D] px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="text-[#B52636]">✦</span>
          <span className="text-xl font-bold tracking-[0.2em]">NEXUS</span>
        </div>

        <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-[#9D8589]">
          NETWORK OPERATIONS SUITE
        </p>
      </div>

      <SidebarNav />
    </aside>
  );
}