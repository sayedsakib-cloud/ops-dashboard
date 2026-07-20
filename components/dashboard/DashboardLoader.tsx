"use client";
import { useEffect, useState } from "react";

// Shows once per browser session (clears on tab close).
// Children always render underneath — they preload while loader is visible.
export default function DashboardLoader({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [phase,   setPhase]   = useState(0); // 0=init 1=loading 2=ready 3=fading

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("ops-init-done")) return; // already shown
    setVisible(true);

    const t1 = setTimeout(() => setPhase(1), 1200);
    const t2 = setTimeout(() => setPhase(2), 2600);
    const t3 = setTimeout(() => setPhase(3), 3600);
    const t4 = setTimeout(() => {
      sessionStorage.setItem("ops-init-done", "1");
      setVisible(false);
    }, 4200);

    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  }, []);

  const MSGS = [
    "INITIALIZING LAUNCH...",
    "LOADING MODULES...",
    "SYSTEMS READY",
    "SYSTEMS READY",
  ];

  return (
    <>
      {/* Loader overlay — only rendered during first session visit */}
      {visible ? (
        <div
          className={`fixed inset-0 z-[200] flex flex-col items-center justify-center transition-opacity duration-500 ${phase >= 3 ? "opacity-0 pointer-events-none" : "opacity-100"}`}
          style={{
            background:
              "radial-gradient(ellipse at 18% 62%, rgba(30,28,60,0.9) 0%, #0a0912 55%, rgba(24,22,52,0.75) 100%)",
          }}
        >
          {/* Spinning arc + center icon */}
          <div className="relative w-32 h-32 flex items-center justify-center">

            {/* Outer arc — slow spin */}
            <svg
              className="absolute inset-0 w-full h-full animate-spin"
              style={{ animationDuration: "3s" }}
              viewBox="0 0 128 128"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="loaderArc1" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
                  <stop offset="0%"   stopColor="#3B82F6" stopOpacity="0" />
                  <stop offset="55%"  stopColor="#5B5BD6" stopOpacity="1" />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity="1" />
                </linearGradient>
              </defs>
              <circle
                cx="64" cy="64" r="60"
                stroke="url(#loaderArc1)"
                strokeWidth="1.5"
                strokeDasharray="282 94"
                strokeLinecap="round"
              />
            </svg>

            {/* Inner arc — faster counter-spin */}
            <svg
              className="absolute inset-0 w-full h-full animate-spin"
              style={{ animationDuration: "1.8s", animationDirection: "reverse" }}
              viewBox="0 0 128 128"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="loaderArc2" x1="128" y1="0" x2="0" y2="128" gradientUnits="userSpaceOnUse">
                  <stop offset="0%"   stopColor="#818cf8" stopOpacity="0" />
                  <stop offset="100%" stopColor="#5B5BD6" stopOpacity="0.4" />
                </linearGradient>
              </defs>
              <circle
                cx="64" cy="64" r="50"
                stroke="url(#loaderArc2)"
                strokeWidth="1"
                strokeDasharray="157 314"
                strokeLinecap="round"
              />
            </svg>

            {/* Center circle with icon */}
            <div
              className="w-[80px] h-[80px] rounded-full flex items-center justify-center z-10"
              style={{
                background: "radial-gradient(circle at 35% 35%, #2e2d6e 0%, #12111f 100%)",
                boxShadow: "0 0 32px rgba(91,91,214,0.3), inset 0 0 20px rgba(59,130,246,0.12)",
              }}
            >
              {/*
                ICON PLACEHOLDER — replace the SVG below with the actual icon
                the user will provide. Keep the w-10 h-10 wrapper size.
              */}
              <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Stylised "OM" analytics icon until real icon is provided */}
                <rect x="6"  y="24" width="5"  height="10" rx="1" fill="#5B5BD6" opacity="0.9" />
                <rect x="14" y="18" width="5"  height="16" rx="1" fill="#5B5BD6" />
                <rect x="22" y="12" width="5"  height="22" rx="1" fill="#818cf8" />
                <rect x="30" y="20" width="5"  height="14" rx="1" fill="#818cf8" opacity="0.7" />
                <path d="M8 22 L16 16 L24 10 L32 18" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>

          {/* Status text */}
          <p
            className="mt-7 text-[11px] font-medium tracking-[0.3em] transition-all duration-500"
            style={{ color: phase >= 2 ? "#818cf8" : "#6a6a8a" }}
          >
            {MSGS[phase]}
          </p>

          {/* Progress dots */}
          <div className="flex gap-2 mt-4">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full transition-all duration-500"
                style={{
                  background:   phase > i ? "#5B5BD6" : "#26263a",
                  boxShadow:    phase > i ? "0 0 6px rgba(91,91,214,0.6)" : "none",
                  transform:    phase > i ? "scale(1.2)" : "scale(1)",
                }}
              />
            ))}
          </div>

          {/* NEXT VENTURES brand mark — place logo.png in /public/logo.png */}
          <img
            src="/logo.png"
            alt="Next Ventures"
            className="absolute bottom-10 h-6 object-contain transition-opacity duration-700"
            style={{ opacity: phase >= 1 ? 0.35 : 0 }}
          />
        </div>
      ) : null}

      {/* Dashboard content — always rendered so data starts loading immediately */}
      {children}
    </>
  );
}
