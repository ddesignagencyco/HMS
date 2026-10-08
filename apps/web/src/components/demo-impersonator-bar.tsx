"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BriefcaseBusiness,
  CircleDollarSign,
  ClipboardCheck,
  Home,
  ShieldCheck,
  UserCheck,
  } from "lucide-react";
import type { Locale } from "@/lib/utils";

interface DemoImpersonatorBarProps {
  locale: Locale;
}

export function DemoImpersonatorBar({ locale }: DemoImpersonatorBarProps) {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);

  /* This bar and the headers below it are both sticky. Anything that pins
     to top:0 lands underneath the other, so the bar publishes its measured
     height and every header below it pins to that offset instead. The bar
     wraps onto a second line on narrow screens, so the height is measured
     rather than assumed. */
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const root = document.documentElement;
    const publish = () => root.style.setProperty("--demo-bar-h", `${bar.offsetHeight}px`);

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--demo-bar-h");
    };
  }, []);

  /* Authentication screens are viewport-locked with no site chrome. */
  const onAuthRoute = pathname.includes("/auth/");
  if (onAuthRoute) return null;

  const roles = [    {
      name: "Home",
      path: `/${locale}`,
      roleBadge: "Home Page",
      icon: Home,
      color: "bg-amber-600 text-white",
    },
    {
      name: "Customer",
      path: `/${locale}/account`,
      roleBadge: "Ayesha Khan (Customer)",
      icon: UserCheck,
      color: "bg-blue-600 text-white",
    },
    {
      name: "Provider (Tradesman)",
      path: `/${locale}/provider`,
      roleBadge: "Ahmad Plumber (PWA Pro)",
      icon: BriefcaseBusiness,
      color: "bg-amber-600 text-white",
    },
    {
      name: "Verification Agent",
      path: `/${locale}/agent`,
      roleBadge: "Agent Desk (SLA Telephony)",
      icon: ClipboardCheck,
      color: "bg-purple-600 text-white",
    },
    {
      name: "Finance Officer",
      path: `/${locale}/finance/escrow`,
      roleBadge: "Finance Ledger (Double Entry)",
      icon: CircleDollarSign,
      color: "bg-emerald-600 text-white",
    },
    {
      name: "Administrator",
      path: `/${locale}/admin`,
      roleBadge: "Admin Ops Control Room",
      icon: ShieldCheck,
      color: "bg-navy-950 text-yellow-400",
    },
  ];

  const currentRole = roles.find((r) => pathname.includes(r.path.split("/")[2])) ?? roles[0];

  return (
    <div ref={barRef} className="sticky top-0 z-50 border-b border-yellow-500/30 bg-slate-950 text-white shadow-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-1.5 text-xs sm:px-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-950">
            DEMO MODE
          </span>
          <span className="hidden text-slate-300 sm:inline">
            Active Role: <strong className="text-white">{currentRole.name}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="hidden text-[11px] text-slate-400 md:inline">Switch Role Persona:</span>
          <div className="flex flex-wrap items-center gap-1">
            {roles.map((role) => {
              const Icon = role.icon;
              const isActive = pathname.startsWith(role.path);
              return (
                <Link
                  key={role.name}
                  href={role.path}
                  className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-semibold transition ${isActive
                    ? `${role.color} ring-1 ring-white/40 shadow-xs`
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
                    }`}
                  title={role.roleBadge}
                >
                  <Icon className="size-3" />
                  <span className="hidden lg:inline">{role.name.split(" ")[0]}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
