"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { FirmProfile } from "@/types";

export function NavBar() {
  const pathname = usePathname();
  const [firm, setFirm] = useState<FirmProfile | null>(null);
  const [settingsAlert, setSettingsAlert] = useState(false);

  const [aiKeysSet, setAiKeysSet] = useState(true);

  useEffect(() => {
    fetch("/api/firm")
      .then((r) => r.json())
      .then((d) => { setFirm(d.firm ?? null); if (!d.firm && pathname !== "/settings") setSettingsAlert(true); })
      .catch(() => {});

    // Check if AI keys are configured
    fetch("/api/setup-status")
      .then((r) => r.json())
      .then((s) => { setAiKeysSet(s.gemini === "ok" || s.anthropic === "ok" || s.openai === "ok"); })
      .catch(() => {});
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-stone-200/70 bg-stone-50/85 backdrop-blur-md backdrop-saturate-150">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">

          {/* Logo / wordmark */}
          <a href="/" className="flex items-center gap-2.5 group">
            {firm?.logoUrl ? (
              <img src={firm.logoUrl} alt={firm.name}
                className="max-h-7 max-w-[100px] object-contain opacity-80 group-hover:opacity-100 transition-opacity" />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs tracking-[0.2em] font-mono font-medium text-stone-400 uppercase group-hover:text-stone-600 transition-colors">
                  Arch
                </span>
                <span className="w-px h-3 bg-stone-300" />
                <span className="font-display text-lg font-light tracking-wide text-stone-800 group-hover:text-stone-950 transition-colors"
                      style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                  Present
                </span>
              </div>
            )}
            {/* Firm name beside logo */}
            {firm?.logoUrl && firm.name && (
              <span className="font-mono text-xs text-stone-500 tracking-widest uppercase hidden sm:inline">
                {firm.name}
              </span>
            )}
          </a>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {[
              { href: "/",            label: "Projects" },
              { href: "/project/new", label: "New"      },
              { href: "/setup",       label: "Setup"    },
              { href: "/settings",    label: "Settings" },
            ].map((link) => (
              <a key={link.href} href={link.href}
                className={`px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase rounded-sm transition-all duration-150 relative ${
                  isActive(link.href)
                    ? "text-stone-900 bg-stone-200/60"
                    : "text-stone-400 hover:text-stone-700 hover:bg-stone-100"
                }`}>
                {link.label}
                {/* Dot badge on Settings when no firm profile exists */}
                {link.href === "/settings" && settingsAlert && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-500 rounded-full" />
                )}
                {link.href === "/setup" && !aiKeysSet && pathname !== "/setup" && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full" />
                )}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {/* One-time setup nudge banner */}
      {settingsAlert && pathname !== "/settings" && (
        <div className="fixed top-14 left-0 right-0 z-40 bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full flex-shrink-0" />
            <p className="text-xs text-amber-800 font-mono">
              Set up your firm profile once — your logo and brand will appear on every PDF.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/settings" className="font-mono text-[10px] uppercase tracking-widest text-amber-700 hover:text-amber-900 underline underline-offset-2">
              Set up now →
            </a>
            <button type="button" onClick={() => setSettingsAlert(false)}
              className="text-amber-500 hover:text-amber-700 font-mono text-xs">✕</button>
          </div>
        </div>
      )}
    </>
  );
}
