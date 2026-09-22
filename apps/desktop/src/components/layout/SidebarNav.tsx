import { NavLink } from "react-router-dom";

const navigationItems = [
  { label: "Dashboard", path: "/" },
  { label: "NetToolBox", path: "/nettoolbox" },
  { label: "IP Calculator++", path: "/ip-calculator" },
  { label: "SSH Manager", path: "/ssh" },
  { label: "Settings", path: "/settings" },
];

export function SidebarNav() {
  return (
    <nav className="space-y-1 p-4">
      {navigationItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/"}
          className={({ isActive }) =>
            isActive
              ? "block rounded-md border-l-2 border-[#B52636] bg-[#1D0D11] px-4 py-3 text-sm"
              : "block rounded-md border-l-2 border-transparent px-4 py-3 text-sm text-[#9D8589] transition-colors hover:bg-[#1D0D11] hover:text-[#EEE5E6]"
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}