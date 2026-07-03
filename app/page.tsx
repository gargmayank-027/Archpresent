"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LandingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // If already logged in, go straight to dashboard
  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="spinner w-5 h-5 text-stone-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="fade-up fade-up-1">
            <p className="font-mono text-[10px] tracking-[0.25em] text-amber-700 uppercase mb-6">
              For architecture & interior design firms
            </p>
            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-light text-stone-900 leading-[1.08] mb-6"
                style={{ fontFamily: "'Cormorant Garamond', serif" }}>
              From floor plan<br />
              <em className="text-stone-500">to client presentation</em>
            </h1>
            <p className="text-stone-500 text-lg leading-relaxed max-w-md mb-10">
              Upload a floor plan. Get AI-powered room analysis, curated interior moodboards,
              and a polished PDF deck — in minutes, not days.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="btn-primary text-sm px-8 py-3">
                Get started free
              </Link>
              <a href="#how-it-works" className="btn-secondary text-sm px-8 py-3">
                See how it works
              </a>
            </div>
          </div>

          {/* Hero visual — stylised PDF preview mockup */}
          <div className="fade-up fade-up-2 relative">
            <div className="relative">
              {/* Main deck mockup */}
              <div className="bg-stone-900 rounded-sm overflow-hidden shadow-2xl aspect-[16/10] flex items-center justify-center">
                <div className="text-center px-8">
                  <div className="w-8 h-px bg-amber-500 mx-auto mb-4" />
                  <p className="font-display text-white text-2xl font-light mb-2"
                     style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                    Concept Presentation
                  </p>
                  <p className="font-mono text-stone-500 text-[9px] uppercase tracking-widest">
                    3 BHK · East-facing · 1200 sqm
                  </p>
                </div>
              </div>
              {/* Floating mood images */}
              <div className="absolute -bottom-4 -right-4 w-28 h-20 bg-stone-200 rounded-sm shadow-lg border border-white" />
              <div className="absolute -bottom-8 right-12 w-24 h-18 bg-stone-300 rounded-sm shadow-lg border border-white" />
              <div className="absolute -top-3 -left-3 w-16 h-16 bg-stone-100 rounded-sm shadow-md border border-white flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7a7570" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 16l5-5 4 4 4-4 5 5" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social proof strip ────────────────────────────────────────────── */}
      <section className="border-y border-stone-200 bg-white/50">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="grid grid-cols-3 gap-8 text-center">
            {[
              { num: "5 min", label: "Average time from upload to PDF" },
              { num: "16 slides", label: "Room-by-room presentation" },
              { num: "100%", label: "Your branding, your firm" },
            ].map((s) => (
              <div key={s.label}>
                <p className="font-display text-3xl font-light text-stone-800 mb-1"
                   style={{ fontFamily: "'Cormorant Garamond', serif" }}>{s.num}</p>
                <p className="font-mono text-[9px] tracking-widest uppercase text-stone-400">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-24 scroll-mt-20">
        <div className="text-center mb-16 fade-up fade-up-2">
          <p className="font-mono text-[10px] tracking-[0.25em] text-stone-400 uppercase mb-4">How it works</p>
          <h2 className="font-display text-4xl font-light text-stone-900"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            Four steps to a polished presentation
          </h2>
        </div>

        <div className="grid md:grid-cols-4 gap-10 fade-up fade-up-3">
          {[
            {
              num: "01",
              title: "Upload",
              desc: "Drop your floor plan — PNG, JPEG, or multi-page PDF. We'll read every room, dimension, and orientation.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              ),
            },
            {
              num: "02",
              title: "Analyse",
              desc: "AI identifies every room, estimates dimensions, detects orientation, and drafts client-friendly strengths.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              ),
            },
            {
              num: "03",
              title: "Style",
              desc: "Pick a style direction. AI curates real interior photos and generates moodboards for every room.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                </svg>
              ),
            },
            {
              num: "04",
              title: "Export",
              desc: "Download a branded 16-slide PDF deck with your firm logo, room crops, and moodboards — ready to send.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              ),
            },
          ].map((step) => (
            <div key={step.num} className="text-center">
              <div className="w-12 h-12 rounded-full border border-stone-200 flex items-center justify-center mx-auto mb-4 text-stone-400">
                {step.icon}
              </div>
              <p className="font-mono text-[10px] tracking-widest uppercase text-amber-600 mb-2">{step.num}</p>
              <p className="font-mono text-xs tracking-widest uppercase text-stone-800 mb-3">{step.title}</p>
              <p className="text-sm text-stone-500 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="bg-stone-900 text-white">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div>
              <p className="font-mono text-[10px] tracking-[0.25em] text-amber-400 uppercase mb-4">Built for architects</p>
              <h2 className="font-display text-4xl font-light leading-tight mb-6"
                  style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                Everything your practice needs to present concepts beautifully
              </h2>
              <p className="text-stone-400 leading-relaxed mb-8">
                ArchPresent understands residential floor plans — rooms, circulation,
                orientation, proportions. It speaks your language so the output
                actually makes sense to your clients.
              </p>
              <Link href="/signup" className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-amber-400 hover:text-amber-300 transition-colors">
                Start presenting → 
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { title: "AI room detection", desc: "Reads plans like an architect — bedrooms, kitchen, lobby, pooja room, all identified." },
                { title: "Real interior photos", desc: "Unsplash-sourced photography, not synthetic renders. Every image credits the photographer." },
                { title: "Your brand, your deck", desc: "Firm logo, accent colors, typography choices. Every PDF looks like it came from your practice." },
                { title: "Multi-floor PDF", desc: "Upload a multi-page PDF. Pick the floor, get the presentation. One plan per project." },
                { title: "Editable plan crops", desc: "AI crops each room from the plan. Not perfect? Drag to adjust the framing yourself." },
                { title: "Share with clients", desc: "Generate a link. Clients view the presentation in their browser — no PDF download needed." },
              ].map((f) => (
                <div key={f.title} className="p-4 border border-stone-700/50 rounded-sm">
                  <p className="font-mono text-[10px] tracking-widest uppercase text-stone-300 mb-2">{f.title}</p>
                  <p className="text-sm text-stone-500 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <p className="font-mono text-[10px] tracking-[0.25em] text-stone-400 uppercase mb-4">Ready?</p>
        <h2 className="font-display text-4xl md:text-5xl font-light text-stone-900 mb-6"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          Your next concept presentation<br /><em className="text-stone-500">starts here</em>
        </h2>
        <p className="text-stone-500 max-w-md mx-auto mb-10">
          Set up your firm profile once. Upload a plan. Send the deck. That's it.
        </p>
        <Link href="/signup" className="btn-primary text-sm px-10 py-3.5">
          Get started free
        </Link>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-stone-200">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] tracking-[0.2em] text-stone-400 uppercase">Arch</span>
            <span className="w-px h-3 bg-stone-300" />
            <span className="font-display text-lg font-light text-stone-600" style={{ fontFamily: "'Cormorant Garamond', serif" }}>Present</span>
          </div>
          <p className="font-mono text-[10px] text-stone-400 tracking-widest uppercase">
            Residential concept presentations for architecture firms
          </p>
        </div>
      </footer>
    </div>
  );
}
