import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Bell,
  Settings,
  LogOut,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import type { ReactNode } from "react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/clara", icon: Sparkles, label: "Clara" },
  { to: "/conversations", icon: MessageSquare, label: "Conversations" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/reminders", icon: Bell, label: "Reminders" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen bg-slate-950">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-950">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-6">
          <img src="/logo.svg" alt="OpenConduit" className="h-7" />
          <span className="text-lg font-bold text-slate-100">
            Clara CRM
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/20"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">
                {user?.name}
              </p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-slate-200"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-slate-950">{children}</main>
    </div>
  );
}
