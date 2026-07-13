"use client";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Users, BarChart3, CheckSquare, Inbox, Mail, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { id: "daily-huddle",   label: "Daily Huddle",         icon: Users       },
  { id: "kpi",            label: "KPI",                  icon: BarChart3   },
  { id: "regular-task",   label: "Regular Task",         icon: CheckSquare },
  { id: "tickets",        label: "Tickets",              icon: Inbox       },
  { id: "trading-ethics", label: "Trading Ethics Email", icon: Mail        },
];

type Props = { active: string; onSwitch: (id: string) => void };

export default function Sidebar({ active, onSwitch }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();
  const name = session?.user?.name ?? "User";
  const email = session?.user?.email ?? "";
  const initial = name.charAt(0).toUpperCase();

  return (
    <aside className={cn(
      "relative z-30 flex h-screen flex-shrink-0 flex-col border-r border-sidebar-border",
      "bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out",
      collapsed ? "w-[72px]" : "w-60",
    )}>
      <div className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-sidebar-border px-4">
        <img src="/fn-logo.svg" alt="FN" width={32} height={32} className="flex-shrink-0 rounded-sm object-contain" />
        {!collapsed ? <span className="whitespace-nowrap text-xl font-bold tracking-tight">Ops Metrics</span> : null}
      </div>

      <button
        onClick={() => setCollapsed(p => !p)}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "absolute -right-3 top-[72px] z-40 flex h-6 w-6 items-center justify-center",
          "rounded-full border border-border bg-background text-muted-foreground shadow-sm",
          "transition-colors hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>

      <nav className="flex-1 space-y-1 overflow-hidden px-2 py-3">
        {NAV.map(item => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button key={item.id} onClick={() => onSwitch(item.id)}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm shadow-primary/30"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}>
              <Icon className="h-[18px] w-[18px] flex-shrink-0" />
              {!collapsed ? <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.label}</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="flex-shrink-0 space-y-1 border-t border-sidebar-border p-3">
        <div className={cn("flex items-center gap-3 rounded-md p-2", collapsed ? "bg-transparent" : "bg-sidebar-accent/50")}>
          {session?.user?.image ? (
            <img src={session.user.image} alt={name} width={32} height={32} referrerPolicy="no-referrer"
              className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {initial}
            </div>
          )}
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-sidebar-foreground">{name}</p>
              <p className="truncate text-[10px] text-sidebar-foreground/50">{email}</p>
            </div>
          ) : null}
        </div>

        <button onClick={() => signOut({ callbackUrl: "/api/auth/signin" })}
          title="Sign out"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium",
            "text-sidebar-foreground/60 transition-colors hover:bg-destructive/15 hover:text-destructive",
          )}>
          <LogOut className="h-[15px] w-[15px] flex-shrink-0" />
          {!collapsed ? <span>Sign Out</span> : null}
        </button>
      </div>
    </aside>
  );
}
