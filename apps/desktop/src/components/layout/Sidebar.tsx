import { SidebarNav } from "./SidebarNav";
import nexusLogo from "../../assets/nexus-logo.png";

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 w-64 border-r border-[#3B171D] bg-[#170A0D]">
      <div className="border-b border-[#3B171D] px-6 py-5">
        <div className="flex items-center">
          <img
            src={nexusLogo}
            alt="NEXUS"
            className="h-10 w-auto max-w-full object-contain object-left"
          />
        </div>

        <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-[#9D8589]">
          NETWORK OPERATIONS SUITE
        </p>
      </div>

      <SidebarNav />
    </aside>
  );
}