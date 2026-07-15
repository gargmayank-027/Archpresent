"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ThemeToggle } from "./ThemeToggle";
import type { FirmProfile } from "@/types";

export function NavBar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [firm, setFirm] = useState<FirmProfile | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    fetch("/api/firm")
      .then((r) => r.json())
      .then((d) => setFirm(d.firm ?? null))
      .catch(() => {});
  }, [pathname]);

  // Close menu on outside click
  useEffect(() => {
    if (!showUserMenu) return;
    const close = () => setShowUserMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showUserMenu]);

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-stone-200/70 bg-stone-50/85 backdrop-blur-md backdrop-saturate-150">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">

        {/* Logo / wordmark */}
        <a href="/dashboard" className="flex items-center gap-2.5 group">
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
          {firm?.logoUrl && firm.name && (
            <span className="font-mono text-xs text-stone-500 tracking-widest uppercase hidden sm:inline">
              {firm.name}
            </span>
          )}
        </a>

        {/* Nav links + user */}
        <div className="flex items-center gap-1">
          <nav className="flex items-center gap-1">
            {[
              { href: "/dashboard",   label: "Projects" },
              { href: "/project/new", label: "New"      },
              { href: "/settings",    label: "Settings" },
            ].map((link) => (
              <a key={link.href} href={link.href}
                className={`px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase rounded-sm transition-all duration-150 relative ${
                  isActive(link.href)
                    ? "text-stone-900 bg-stone-200/60"
                    : "text-stone-400 hover:text-stone-700 hover:bg-stone-100"
                }`}>
                {link.label}
              </a>
            ))}
          </nav>

          {/* Theme toggle + user avatar */}
          <ThemeToggle />
          {session?.user && (
            <div className="relative ml-3">
              <button type="button"
                onClick={(e) => { e.stopPropagation(); setShowUserMenu(!showUserMenu); }}
                className="w-8 h-8 rounded-full overflow-hidden border border-stone-200 hover:border-stone-400 transition-colors flex items-center justify-center bg-stone-100"
              >
                {session.user.image ? (
                  <img src={session.user.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="font-mono text-[10px] text-stone-500 uppercase">
                    {session.user.name?.[0] ?? session.user.email?.[0] ?? "?"}
                  </span>
                )}
              </button>

              {showUserMenu && (
                <div className="absolute right-0 top-10 z-30 w-56 bg-white border border-stone-200 rounded-sm overflow-hidden fade-up"
                  style={{ boxShadow: "0 4px 16px rgba(26,25,23,0.10), 0 2px 4px rgba(26,25,23,0.06)" }}
                  onClick={(e) => e.stopPropagation()}>
                  <div className="px-4 py-3 border-b border-stone-100">
                    <p className="text-xs text-stone-800 font-medium truncate">{session.user.name}</p>
                    <p className="text-[10px] text-stone-400 truncate">{session.user.email}</p>
                  </div>
                  <button type="button"
                    onClick={() => signOut({ callbackUrl: "/" })}
                    className="w-full text-left px-4 py-3 text-xs text-stone-500 hover:bg-stone-50 hover:text-stone-700 transition-colors flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
