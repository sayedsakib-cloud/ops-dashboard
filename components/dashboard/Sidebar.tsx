"use client";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
  Users,
  BarChart3,
  CheckSquare,
  Inbox,
  Mail,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";

const NAV = [
  { id: "daily-huddle",   label: "Daily Huddle",             icon: Users       },
  { id: "kpi",            label: "KPI",                      icon: BarChart3   },
  { id: "regular-task",   label: "Regular Task",             icon: CheckSquare },
  { id: "tickets",        label: "Tickets",                  icon: Inbox       },
  { id: "trading-ethics", label: "Trading Ethics Email",     icon: Mail        },
];

type Props = {
  active: string;
  onSwitch: (id: string) => void;
};

export default function Sidebar({ active, onSwitch }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();

  const name    = session?.user?.name  ?? "User";
  const email   = session?.user?.email ?? "";
  const initial = name.charAt(0).toUpperCase();

  return (
    <div
      className="relative flex flex-col flex-shrink-0 h-screen border-r transition-all duration-300 ease-in-out"
      style={{
        width:           collapsed ? "72px" : "240px",
        background:      "#0e1623",
        borderColor:     "#1a2540",
      }}
    >
      {/* ── Logo / Branding ──────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 h-16 border-b flex-shrink-0"
        style={{ borderColor: "#1a2540" }}
      >
        {/* FN logo — place fn-logo.svg in /public/fn-logo.svg */}
        <img
          src="/fn-logo.svg"
          alt="FN"
          width={32}
          height={32}
          className="flex-shrink-0 rounded-sm"
          style={{ objectFit: "contain" }}
        />

        {!collapsed ? (
          <span
            className="font-bold text-xl whitespace-nowrap"
            style={{ color: "#e2e8f0" }}
          >
            Ops Metrics
          </span>
        ) : null}
      </div>

      {/* ── Collapse toggle ───────────────────────────────────── */}
      <button
        onClick={() => setCollapsed(prev => !prev)}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute z-10 flex items-center justify-center w-6 h-6 rounded-full transition-colors"
        style={{
          top:         "44px",
          right:       "-12px",
          background:  "#1e2d47",
          border:      "1px solid #2a3d5e",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#263a5a"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#1e2d47"; }}
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3" style={{ color: "#94a3b8" }} />
        ) : (
          <ChevronLeft  className="w-3 h-3" style={{ color: "#94a3b8" }} />
        )}
      </button>

      {/* ── Navigation items ─────────────────────────────────── */}
      <nav className="flex-1 py-3 overflow-hidden">
        {NAV.map(item => {
          const Icon     = item.icon;
          const isActive = active === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSwitch(item.id)}
              title={collapsed ? item.label : undefined}
              className="relative w-full flex items-center gap-3 py-2.5 mb-1 text-left rounded-xl transition-all duration-150"
              style={{
                paddingLeft:     "12px",
                paddingRight:    "12px",
                background:   isActive ? "rgba(14,165,233,0.12)" : "transparent",
                border:       isActive ? "1px solid rgba(56,189,248,0.22)" : "1px solid transparent",
                color:        isActive ? "#7dd3fc" : "#64748b",
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                  (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = "#64748b";
                }
              }}
            >
              <Icon
                className="flex-shrink-0"
                style={{ width: "18px", height: "18px", color: isActive ? "#38bdf8" : "currentColor" }}
                />

              {!collapsed ? (
                <span
                  className="text-base font-medium whitespace-nowrap overflow-hidden text-ellipsis"
                  style={{ color: "inherit" }}
                >
                  {item.label}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* ── User info + Sign out ─────────────────────────────── */}
      <div
        className="border-t flex-shrink-0 p-3 space-y-1"
        style={{ borderColor: "#1a2540" }}
      >
        {/* User card */}
        <div
          className="flex items-center gap-3 p-2 rounded-lg"
          style={{ background: collapsed ? "transparent" : "#111f35" }}
        >
        {/* Avatar — uses Google profile photo if available */}
        {session?.user?.image ? (
          <img
            src={session.user.image}
            alt={name}
            width={32}
            height={32}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)" }}
          >
            {initial}
          </div>
        )}

          {!collapsed ? (
            <div className="flex-1 min-w-0">
              <p
                className="text-xs font-semibold truncate"
                style={{ color: "#cbd5e1" }}
              >
                {name}
              </p>
              <p
                className="text-[10px] truncate"
                style={{ color: "#475569" }}
              >
                {email}
              </p>
            </div>
          ) : null}
        </div>

        {/* Sign out button */}
        <button
          onClick={() => signOut({ callbackUrl: "/api/auth/signin" })}
          title="Sign out"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors"
          style={{ color: "#64748b" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "#f87171";
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.08)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "#64748b";
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          <LogOut style={{ width: "15px", height: "15px", flexShrink: 0 }} />
          {!collapsed ? (
            <span className="text-xs font-medium" style={{ color: "inherit" }}>
              Sign Out
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
