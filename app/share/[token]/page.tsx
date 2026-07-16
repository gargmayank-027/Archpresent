"use client";

/**
 * app/share/[token]/page.tsx
 *
 * The client-facing presentation viewer.
 *
 * This used to hand-rebuild the entire deck in JSX — CoverSlide, SiteSlide,
 * PlanSlide, StrengthsSlide, WalkthroughSlide, HighlightsSlide, VastuSlide,
 * ThankYouSlide — roughly 700 lines that duplicated lib/pdf.ts and shared no
 * code with it. Two implementations of one artifact guarantee drift, and they
 * did drift: redesigning the PDF left this screen on the old layout, ignoring
 * the firm's chosen theme.
 *
 * It now renders the actual exported PDF with pdf.js, the same way the Export
 * screen does. The client sees exactly the document the architect approved,
 * and there is no second implementation left to fall out of sync.
 *
 * The shell — slide navigation, progress, view tracking, the feedback panel,
 * and the call-to-action bar — stays native so it remains usable on a phone.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import type { Project } from "@/types";

interface FirmContact {
  phone?: string;
  email?: string;
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [firmContact, setFirmContact] = useState<FirmContact>({});
  const [pages, setPages] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const [showNav, setShowNav] = useState(true);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load project metadata (also records the view) ──────────────────────
  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); setLoading(false); return; }
        setProject(d.project);
        setFirmContact(d.firmContact ?? {});
      })
      .catch(() => { setError("Failed to load presentation"); setLoading(false); });
  }, [token]);

  // ── Load + render the real deck PDF ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/share/${token}/pdf`, { cache: "no-store" });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? "Could not load presentation");
        }

        try {
          const raw = res.headers.get("X-Deck-Page-Labels");
          if (raw) setLabels(JSON.parse(decodeURIComponent(raw)));
        } catch { /* labels are cosmetic — never block the deck on them */ }

        const bytes = await res.arrayBuffer();

        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        const out: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          // 2x for legibility on high-DPI phones without ballooning memory.
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          out.push(canvas.toDataURL("image/jpeg", 0.88));
          // Show pages as they finish rather than blocking on the whole deck.
          if (!cancelled) setPages([...out]);
        }
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load presentation");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const resetTimer = useCallback(() => {
    setShowNav(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShowNav(false), 3000);
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("touchstart", resetTimer);
    resetTimer();
    return () => {
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("touchstart", resetTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (pages.length === 0) return;
      if (e.key === "ArrowRight" || e.key === " ") setSlide((s) => Math.min(s + 1, pages.length - 1));
      if (e.key === "ArrowLeft") setSlide((s) => Math.max(s - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length]);

  async function sendFeedback(body: Record<string, unknown>) {
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shareToken: token,
          clientName: feedbackName || "Client",
          slideIndex: slide,
          ...body,
        }),
      });
      setFeedbackSent(true);
      setTimeout(() => setFeedbackSent(false), 2000);
    } catch { /* feedback is best-effort — never blocks viewing */ }
  }

  if (loading && pages.length === 0) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;
  if (!project) return <ErrorScreen message="Presentation not found" />;

  const total = pages.length;
  const isLast = slide === total - 1;
  const phone = firmContact.phone;
  const email = firmContact.email;
  const label = labels[slide];

  return (
    <div className="fixed inset-0 bg-[#0d0d0e] flex flex-col overflow-hidden">
      {/* Progress */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10 z-30">
        <div className="h-full bg-white/60 transition-all duration-300"
          style={{ width: total ? `${((slide + 1) / total) * 100}%` : "0%" }} />
      </div>

      {/* Slide — the actual PDF page */}
      <div className="flex-1 flex items-center justify-center p-3 sm:p-8 min-h-0"
        onClick={() => setSlide((s) => Math.min(s + 1, total - 1))}>
        {pages[slide] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pages[slide]} alt={label ?? `Slide ${slide + 1}`}
            className="max-w-full max-h-full object-contain shadow-2xl select-none" />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <span className="spinner" />
            <p className="text-white/40 text-xs font-mono">Preparing slide {slide + 1}…</p>
          </div>
        )}
      </div>

      {/* Nav bar */}
      <div className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300 ${
        showNav || isLast ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="bg-gradient-to-t from-black/80 to-transparent px-4 sm:px-6 pt-10 pb-4">
          <div className="flex items-center gap-3">
            <button type="button" disabled={slide === 0}
              onClick={(e) => { e.stopPropagation(); setSlide((s) => Math.max(s - 1, 0)); }}
              className="text-white/50 hover:text-white disabled:opacity-20 text-sm px-2">←</button>

            <div className="flex items-center gap-1.5 flex-1 justify-center">
              {pages.map((_, i) => (
                <button key={i} type="button" aria-label={labels[i] ?? `Slide ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); setSlide(i); }}
                  className={`h-1.5 rounded-full transition-all ${
                    i === slide ? "w-5 bg-white/80" : "w-1.5 bg-white/25 hover:bg-white/50"}`} />
              ))}
            </div>

            <button type="button" disabled={slide >= total - 1}
              onClick={(e) => { e.stopPropagation(); setSlide((s) => Math.min(s + 1, total - 1)); }}
              className="text-white/50 hover:text-white disabled:opacity-20 text-sm px-2">→</button>
          </div>

          <div className="flex items-center justify-between mt-2.5">
            <span className="font-mono text-[9px] uppercase tracking-widest text-white/35 truncate">
              {label ? `${label} · ` : ""}{slide + 1} / {total}
            </span>

            {/* CTA — always reachable, not only on the last slide. Falls back to
                email when the firm has no phone; the old version gated every
                CTA on plotInfo.phone, so a firm that skipped the optional phone
                field during onboarding silently showed clients no way to
                respond at all. */}
            <div className="flex items-center gap-2">
              {phone && (
                <>
                  <a href={`tel:${phone}`} onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition-colors">
                    <span className="text-[9px] text-white/80 font-mono uppercase tracking-widest">Call</span>
                  </a>
                  <a href={`https://wa.me/${phone.replace(/[^0-9]/g, "")}`}
                    target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 bg-emerald-600/90 hover:bg-emerald-600 rounded-full px-3 py-1.5 transition-colors">
                    <span className="text-[9px] text-white font-mono uppercase tracking-widest">WhatsApp</span>
                  </a>
                </>
              )}
              {!phone && email && (
                <a href={`mailto:${email}?subject=${encodeURIComponent(project.name)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition-colors">
                  <span className="text-[9px] text-white/80 font-mono uppercase tracking-widest">Email us</span>
                </a>
              )}
              <button type="button"
                onClick={(e) => { e.stopPropagation(); setShowFeedback((v) => !v); }}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition-colors">
                <span className="text-[9px] text-white/80 font-mono uppercase tracking-widest">Feedback</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback panel */}
      {showFeedback && (
        <div className="absolute bottom-24 right-4 z-30 w-[min(20rem,calc(100vw-2rem))] bg-[#1a1917] ring-1 ring-white/10 rounded-lg p-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[9px] uppercase tracking-widest text-white/40">
              {label ? `On "${label}"` : `On slide ${slide + 1}`}
            </p>
            <button type="button" onClick={() => setShowFeedback(false)}
              className="text-white/30 hover:text-white/70 text-xs">✕</button>
          </div>

          <div className="flex gap-2 mb-3">
            {["❤️", "👍", "🤔", "💭"].map((r) => (
              <button key={r} type="button" onClick={() => sendFeedback({ reaction: r })}
                className="flex-1 bg-white/5 hover:bg-white/15 rounded py-2 text-lg transition-colors">{r}</button>
            ))}
          </div>

          <input value={feedbackName} onChange={(e) => setFeedbackName(e.target.value)}
            placeholder="Your name"
            className="w-full bg-white/5 text-white/80 text-xs rounded px-3 py-2 mb-2 outline-none placeholder:text-white/25 focus:bg-white/10" />
          <textarea value={feedbackComment} onChange={(e) => setFeedbackComment(e.target.value)}
            placeholder="Add a comment…" rows={3}
            className="w-full bg-white/5 text-white/80 text-xs rounded px-3 py-2 mb-2 outline-none resize-none placeholder:text-white/25 focus:bg-white/10" />
          <button type="button"
            onClick={() => { if (feedbackComment.trim()) { sendFeedback({ comment: feedbackComment }); setFeedbackComment(""); } }}
            disabled={!feedbackComment.trim()}
            className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white/80 text-xs rounded py-2 transition-colors">
            Send to architect
          </button>

          {feedbackSent && (
            <p className="text-emerald-400/80 text-[10px] text-center mt-2 font-mono">Sent — thank you</p>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-[#0d0d0e] flex flex-col items-center justify-center gap-3">
      <span className="spinner" />
      <p className="text-white/40 text-xs font-mono uppercase tracking-widest">Preparing your presentation</p>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 bg-[#0d0d0e] flex flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-white/70 text-sm">{message}</p>
      <p className="text-white/30 text-xs">Please ask your architect for an updated link.</p>
    </div>
  );
}
