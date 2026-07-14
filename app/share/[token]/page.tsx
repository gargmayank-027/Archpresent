"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import type { Project } from "@/types";

export default function SharePage() {
  const { token }  = useParams<{ token: string }>();
  const [project,  setProject]  = useState<Project | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [slide,    setSlide]    = useState(0);
  const [showNav,  setShowNav]  = useState(true);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); setLoading(false); return; }
        setProject(d.project); setLoading(false);
      })
      .catch(() => { setError("Failed to load presentation"); setLoading(false); });
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
      if (!project) return;
      const n = buildSlides(project).length;
      if (e.key === "ArrowRight" || e.key === " ") setSlide((s) => Math.min(s + 1, n - 1));
      if (e.key === "ArrowLeft")  setSlide((s) => Math.max(s - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project]);

  if (loading)  return <LoadingScreen />;
  if (error)    return <ErrorScreen message={error} />;
  if (!project) return <ErrorScreen message="Presentation not found" />;

  const slides  = buildSlides(project);
  const current = slides[slide];

  async function sendReaction(reaction: string) {
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shareToken: token,
          clientName: feedbackName || "Client",
          reaction,
          slideIndex: slide,
        }),
      });
      setFeedbackSent(true);
      setTimeout(() => setFeedbackSent(false), 2000);
    } catch {}
  }

  async function sendComment() {
    if (!feedbackComment.trim()) return;
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shareToken: token,
          clientName: feedbackName || "Client",
          comment: feedbackComment,
          slideIndex: slide,
        }),
      });
      setFeedbackComment("");
      setFeedbackSent(true);
      setTimeout(() => setFeedbackSent(false), 2000);
    } catch {}
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col select-none"
         style={{ fontFamily: "'Instrument Sans', system-ui, sans-serif" }}>
      <div className="flex-1 relative overflow-hidden">
        <SlideRenderer slide={current} project={project} />
        <button className="absolute left-0 top-0 w-1/3 h-full z-10 cursor-w-resize opacity-0"
          onClick={() => { setSlide((s) => Math.max(s - 1, 0)); resetTimer(); }} />
        <button className="absolute right-0 top-0 w-1/3 h-full z-10 cursor-e-resize opacity-0"
          onClick={() => { setSlide((s) => Math.min(s + 1, slides.length - 1)); resetTimer(); }} />

        {/* Feedback button — top right */}
        <button onClick={() => setShowFeedback(!showFeedback)}
          className="absolute top-4 right-4 z-20 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 transition-all flex items-center gap-2">
          <span className="text-sm">💬</span>
          <span className="text-[10px] text-white/60 uppercase tracking-widest font-mono">Feedback</span>
        </button>

        {/* Feedback panel */}
        {showFeedback && (
          <div className="absolute top-14 right-4 z-20 w-72 bg-white/95 backdrop-blur-md rounded-lg shadow-2xl p-4"
            onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-stone-800 font-medium mb-3">How do you feel about this design?</p>

            {/* Reactions */}
            <div className="flex gap-2 mb-3">
              {[
                { emoji: "❤️", label: "Love it", value: "love" },
                { emoji: "👍", label: "Good", value: "like" },
                { emoji: "🤔", label: "Thinking", value: "neutral" },
                { emoji: "💭", label: "Concern", value: "concern" },
              ].map((r) => (
                <button key={r.value} onClick={() => sendReaction(r.value)}
                  className="flex-1 flex flex-col items-center gap-1 p-2 rounded-md hover:bg-stone-100 transition-colors">
                  <span className="text-lg">{r.emoji}</span>
                  <span className="text-[8px] text-stone-500 uppercase">{r.label}</span>
                </button>
              ))}
            </div>

            {/* Name */}
            <input type="text" placeholder="Your name (optional)"
              value={feedbackName} onChange={(e) => setFeedbackName(e.target.value)}
              className="w-full text-xs border border-stone-200 rounded px-3 py-2 mb-2 bg-white" />

            {/* Comment */}
            <textarea placeholder="Any specific thoughts on this slide?"
              value={feedbackComment} onChange={(e) => setFeedbackComment(e.target.value)}
              rows={2}
              className="w-full text-xs border border-stone-200 rounded px-3 py-2 mb-2 bg-white resize-none" />

            <button onClick={sendComment} disabled={!feedbackComment.trim()}
              className="w-full text-[10px] uppercase tracking-widest bg-stone-900 text-white py-2 rounded hover:bg-stone-700 disabled:opacity-30 transition-colors">
              {feedbackSent ? "Sent!" : "Send feedback"}
            </button>

            <p className="text-[9px] text-stone-400 text-center mt-2">
              Slide {slide + 1} of {slides.length}: {current.label}
            </p>
          </div>
        )}
      </div>

      {/* Bottom bar — progress + navigation + CTA */}
      <div className={`flex-shrink-0 transition-opacity duration-300 ${showNav ? "opacity-100" : "opacity-0"}`}>
        {/* Progress bar */}
        <div className="h-0.5 bg-white/10">
          <div className="h-full bg-white/50 transition-all duration-500 ease-out"
               style={{ width: `${((slide + 1) / slides.length) * 100}%` }} />
        </div>

        <div className="bg-black/80 backdrop-blur-sm px-4 sm:px-5 py-3 flex items-center gap-3">
          {/* Slide label */}
          <div className="flex-1 min-w-0 hidden sm:block">
            <p className="text-[10px] text-white/30 font-mono uppercase tracking-widest truncate">{current.label}</p>
            <p className="text-xs text-white/50 truncate">{project.name} — {project.firmName}</p>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2 mx-auto sm:mx-0">
            <button onClick={() => { setSlide((s) => Math.max(s - 1, 0)); resetTimer(); }} disabled={slide === 0}
              className="text-white/50 hover:text-white disabled:opacity-20 transition-colors px-2 py-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div className="flex items-center gap-1">
              {slides.map((_, i) => (
                <button key={i} onClick={() => { setSlide(i); resetTimer(); }}
                  className={`rounded-full transition-all duration-300 ${i === slide ? "w-5 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/20 hover:bg-white/40"}`} />
              ))}
            </div>
            <button onClick={() => { setSlide((s) => Math.min(s + 1, slides.length - 1)); resetTimer(); }} disabled={slide === slides.length - 1}
              className="text-white/50 hover:text-white disabled:opacity-20 transition-colors px-2 py-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          {/* CTA — on last slide or always visible on mobile */}
          <div className="flex-1 flex justify-end gap-2">
            {slide === slides.length - 1 && project.plotInfo?.phone ? (
              <>
                <a href={`tel:${project.plotInfo.phone}`}
                  className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                  <span className="text-[9px] text-white/70 font-mono uppercase tracking-widest">Call</span>
                </a>
                <a href={`https://wa.me/${project.plotInfo.phone.replace(/[^0-9+]/g, "")}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 bg-emerald-600/80 hover:bg-emerald-600 rounded-full px-3 py-1.5 transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                  <span className="text-[9px] text-white font-mono uppercase tracking-widest">WhatsApp</span>
                </a>
              </>
            ) : (
              <span className="font-mono text-[10px] text-white/20">{slide + 1}/{slides.length}</span>
            )}
          </div>
        </div>
      </div>
      <KeyboardHint />
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type SlideType = "cover" | "site" | "plan" | "strengths" | "walkthrough" | "highlights" | "vastu" | "overall-mood" | "room-mood" | "thankyou";
type Slide = { type: SlideType; label: string; roomName?: string };

function buildSlides(p: Project): Slide[] {
  const isConcept = p.presentationType === "concept";

  if (isConcept) {
    return [
      { type: "cover", label: "Cover" },
      ...(p.plotInfo && Object.keys(p.plotInfo).length > 0 ? [{ type: "site" as SlideType, label: "Site Context" }] : []),
      { type: "plan", label: "Floor Plan" },
      ...((p.planStrengths ?? []).length > 0 ? [{ type: "strengths" as SlideType, label: "Plan Strengths" }] : []),
      ...((p.analysis?.rooms?.length ?? 0) > 0 ? [{ type: "walkthrough" as SlideType, label: "Room Walkthrough" }] : []),
      ...((p.analysis?.rooms?.length ?? 0) > 0 ? [{ type: "highlights" as SlideType, label: "Why This Works" }] : []),
      ...(p.plotInfo?.facing ? [{ type: "vastu" as SlideType, label: "Vastu Analysis" }] : []),
      { type: "thankyou", label: "Thank You" },
    ];
  }

  // Interior presentation
  return [
    { type: "cover", label: "Cover" },
    ...(p.plotInfo && Object.keys(p.plotInfo).length > 0 ? [{ type: "site" as SlideType, label: "Site Context" }] : []),
    { type: "plan", label: "Floor Plan" },
    ...((p.planStrengths ?? []).length > 0 ? [{ type: "strengths" as SlideType, label: "Plan Strengths" }] : []),
    ...(p.overallMoodboard ? [{ type: "overall-mood" as SlideType, label: "Interior Style" }] : []),
    ...(p.roomMoodboards ?? []).map((rm) => ({ type: "room-mood" as SlideType, label: rm.roomName, roomName: rm.roomName })),
    { type: "thankyou", label: "Thank You" },
  ];
}

// ─── Renderer ─────────────────────────────────────────────────────────────────
function SlideRenderer({ slide, project: p }: { slide: Slide; project: Project }) {
  switch (slide.type) {
    case "cover":        return <CoverSlide project={p} />;
    case "site":         return <SiteSlide project={p} />;
    case "plan":         return <PlanSlide project={p} />;
    case "strengths":    return <StrengthsSlide project={p} />;
    case "walkthrough":  return <WalkthroughSlide project={p} />;
    case "highlights":   return <HighlightsSlide project={p} />;
    case "vastu":        return <VastuSlide project={p} />;
    case "overall-mood": return <OverallMoodSlide project={p} />;
    case "room-mood":    return <RoomMoodSlide project={p} roomName={slide.roomName!} />;
    case "thankyou":     return <ThankYouSlide project={p} />;
    default:             return <div className="w-full h-full bg-stone-900" />;
  }
}

// ─── Cover ────────────────────────────────────────────────────────────────────
function CoverSlide({ project: p }: { project: Project }) {
  return (
    <div className="w-full h-full flex" style={{ animation: "fadeIn .4s ease" }}>
      <div className="w-[42%] flex flex-col justify-between p-8 md:p-14 bg-stone-900">
        <p className="font-mono text-[9px] text-white/30 uppercase tracking-[0.2em]">Concept Presentation</p>
        <div className="space-y-4">
          <div className="w-10 h-px bg-white/20" />
          <h1 className="text-xl md:text-3xl font-bold text-white leading-tight uppercase">{p.name}</h1>
          <div>
            <p className="text-xs text-white/40">Prepared for</p>
            <p className="text-base text-white/80 italic mt-0.5">{p.clientName}</p>
          </div>
        </div>
        <div>
          {p.plotInfo && (
            <p className="font-mono text-[9px] text-white/25 uppercase tracking-widest mb-1">
              {[p.plotInfo.numberOfBedrooms && `${p.plotInfo.numberOfBedrooms} BHK`, p.plotInfo.propertyType, p.plotInfo.facing && `${p.plotInfo.facing}-facing`].filter(Boolean).join("  ·  ")}
            </p>
          )}
          <p className="font-mono text-[9px] text-white/20">
            {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </div>
      <div className="flex-1 bg-[#f7f5f2] flex flex-col justify-between p-8 md:p-14">
        <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest text-right">{p.firmName}</p>
        <div className="space-y-2">
          {p.styleProfile && (
            <>
              <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">Interior Style</p>
              <p className="text-lg text-stone-700">{p.styleProfile.overallStyle}</p>
              <p className="font-mono text-[9px] text-stone-400">{p.styleProfile.palette.replace(/([A-Z])/g, " $1").trim()}  ·  {p.styleProfile.budgetVibe}</p>
            </>
          )}
        </div>
        <p className="font-mono text-[9px] text-stone-200 uppercase tracking-widest">Residential Concept  ·  Floor Plan + Moodboard</p>
      </div>
    </div>
  );
}

// ─── Site ─────────────────────────────────────────────────────────────────────
function SiteSlide({ project: p }: { project: Project }) {
  const pi = p.plotInfo!;
  const rows = [
    { l: "Property Type", v: pi.propertyType },
    { l: "Configuration", v: pi.numberOfBedrooms ? `${pi.numberOfBedrooms} BHK` : null },
    { l: "Built-up Area", v: pi.builtUpAreaSqm  ? `${pi.builtUpAreaSqm} sqm`   : null },
    { l: "Plot Area",     v: pi.plotAreaSqm     ? `${pi.plotAreaSqm} sqm`       : null },
    { l: "Facing",        v: pi.facing },
    { l: "Floor",         v: pi.floorLocation ? `${pi.floorLocation} floor`     : null },
    { l: "Vaastu",        v: pi.vaastuCompliance ? "Required"                   : null },
  ].filter((r) => r.v);
  return (
    <div className="w-full h-full bg-[#f7f5f2] flex" style={{ animation: "fadeIn .4s ease" }}>
      <div className="flex-1 flex flex-col p-8 md:p-12 overflow-hidden">
        <p className="font-mono text-[9px] text-stone-500 uppercase tracking-widest mb-4">Site Context</p>
        <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-x-10 content-start">
          {rows.map((r, i) => (
            <div key={i} className={`flex items-center py-2.5 px-2 ${i % 2 === 0 ? "bg-stone-100/70" : ""}`}>
              <span className="font-mono text-[9px] uppercase tracking-widest text-stone-400 w-32 flex-shrink-0">{r.l}</span>
              <span className="text-sm text-stone-800">{r.v}</span>
            </div>
          ))}
        </div>
        {pi.additionalNotes && (
          <div className="mt-4 pt-3 border-t border-stone-200">
            <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-1">Notes</p>
            <p className="text-xs text-stone-600 leading-relaxed">{pi.additionalNotes}</p>
          </div>
        )}
      </div>
      {pi.facing && (
        <div className="w-44 flex flex-col items-center justify-center p-6 border-l border-stone-200">
          <CompassSVG facing={pi.facing} />
          <p className="font-mono text-[9px] text-stone-400 mt-3 uppercase tracking-widest text-center">{pi.facing} facing</p>
        </div>
      )}
    </div>
  );
}

// ─── Plan ─────────────────────────────────────────────────────────────────────
function PlanSlide({ project: p }: { project: Project }) {
  // Use best available plan: AI render > color-coded > enhanced > original
  const planSrc = p.aiRenderedPlanUrl ?? p.renderedPlanUrl ?? p.planImageUrl;

  return (
    <div className="w-full h-full bg-[#111110] flex flex-col sm:flex-row" style={{ animation: "fadeIn .4s ease" }}>
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <img src={planSrc} alt="Floor Plan" className="max-w-full max-h-full object-contain rounded" style={{ imageRendering: "crisp-edges" }} />
      </div>
      <div className="w-full sm:w-48 bg-[#0d0d0c] flex flex-col justify-between p-4 sm:p-5 border-t sm:border-t-0 sm:border-l border-white/5 max-h-48 sm:max-h-none overflow-y-auto">
        <div>
          <p className="font-mono text-[9px] text-stone-600 uppercase tracking-widest mb-3">Rooms</p>
          {(p.analysis?.rooms ?? []).map((r, i) => (
            <div key={i} className="flex justify-between py-1.5 border-b border-white/5">
              <span className="text-[10px] text-stone-500 truncate">{r.name}</span>
              {r.sizeEstimateSqm && <span className="font-mono text-[9px] text-stone-700 ml-2 flex-shrink-0">{r.sizeEstimateSqm}m2</span>}
            </div>
          ))}
        </div>
        {p.analysis?.totalAreaSqm && <p className="font-mono text-[9px] text-stone-600 mt-3">Total: {p.analysis.totalAreaSqm} m2</p>}
      </div>
    </div>
  );
}

// ─── Strengths ────────────────────────────────────────────────────────────────
function StrengthsSlide({ project: p }: { project: Project }) {
  const s = p.planStrengths ?? [];
  const c1 = s.slice(0, Math.ceil(s.length / 2));
  const c2 = s.slice(Math.ceil(s.length / 2));
  return (
    <div className="w-full h-full bg-[#f7f5f2] flex flex-col p-8 md:p-14 overflow-hidden" style={{ animation: "fadeIn .4s ease" }}>
      <p className="font-mono text-[9px] text-stone-500 uppercase tracking-widest mb-1">Plan Strengths</p>
      <p className="text-sm text-stone-400 italic mb-5">What makes {p.name} work for you</p>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-x-12 overflow-auto">
        {[c1, c2].map((col, ci) => (
          <div key={ci}>
            {col.map((text, i) => (
              <div key={i} className="flex gap-4 py-3 border-b border-stone-200 last:border-0">
                <span className="font-mono text-[10px] text-stone-200 flex-shrink-0 w-6">{String(ci === 0 ? i + 1 : c1.length + i + 1).padStart(2, "0")}</span>
                <p className="text-sm text-stone-700 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Overall mood ─────────────────────────────────────────────────────────────
function OverallMoodSlide({ project: p }: { project: Project }) {
  const mb = p.overallMoodboard!;
  return (
    <div className="w-full h-full bg-[#0d0d0c] flex flex-col" style={{ animation: "fadeIn .4s ease" }}>
      <div className="flex items-center justify-between px-7 py-4 flex-shrink-0">
        <div>
          <p className="font-mono text-[9px] text-stone-600 uppercase tracking-widest">Interior Style</p>
          <p className="text-lg font-bold text-white uppercase tracking-wide mt-0.5">{p.styleProfile?.overallStyle ?? "Overall Concept"}</p>
        </div>
        <p className="text-xs text-stone-500 italic max-w-xs text-right hidden md:block">"{mb.styleStatement}"</p>
      </div>
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-0.5 p-0.5 overflow-hidden">
        {mb.images.slice(0, 4).map((img, i) => (
          <div key={i} className="relative overflow-hidden group">
            <img src={img.url} alt={img.caption} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="absolute bottom-3 left-4 font-mono text-[9px] text-white uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">{img.caption}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Room mood ────────────────────────────────────────────────────────────────
function RoomMoodSlide({ project: p, roomName }: { project: Project; roomName: string }) {
  const rm = p.roomMoodboards?.find((r) => r.roomName === roomName);
  const rd = p.analysis?.rooms.find((r) => r.name === roomName);
  if (!rm) return <div className="w-full h-full bg-stone-900" />;
  return (
    <div className="w-full h-full bg-[#f7f5f2] flex overflow-hidden" style={{ animation: "fadeIn .4s ease" }}>
      <div className="w-[22%] bg-white border-r border-stone-200 flex flex-col p-4 gap-3 overflow-hidden">
        <div>
          <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-1">{rm.roomName}</p>
          {rd?.sizeEstimateSqm && <p className="text-xl font-light text-stone-800">{rd.sizeEstimateSqm}<span className="text-xs text-stone-400 ml-1">m²</span></p>}
          {rd?.orientation && <p className="font-mono text-[9px] text-stone-400 mt-0.5">{rd.orientation}</p>}
        </div>
        <div className="flex-1 flex items-center justify-center bg-stone-50 rounded-sm overflow-hidden min-h-0">
          {rm.planSnippetUrl
            ? <img src={rm.planSnippetUrl} alt="plan" className="max-w-full max-h-full object-contain" style={{ imageRendering: "crisp-edges" }} />
            : <p className="font-mono text-[9px] text-stone-300 text-center uppercase px-2">Plan snippet</p>}
        </div>
        {rd?.specialFeatures && rd.specialFeatures.length > 0 && (
          <div className="space-y-0.5 flex-shrink-0">
            {rd.specialFeatures.slice(0, 3).map((f) => <p key={f} className="font-mono text-[9px] text-stone-400">· {f}</p>)}
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col gap-0.5 p-0.5 min-w-0 overflow-hidden">
        <div className="flex-1 grid grid-cols-3 gap-0.5 min-h-0">
          {rm.images.slice(0, 3).map((img, i) => (
            <div key={i} className="relative overflow-hidden group">
              <img src={img.url} alt={img.caption} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="absolute bottom-2 left-2 font-mono text-[9px] text-white uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">{img.caption}</span>
            </div>
          ))}
        </div>
        {rm.images[3] && (
          <div className="h-20 relative overflow-hidden group flex-shrink-0">
            <img src={rm.images[3].url} alt={rm.images[3].caption} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-[9px] text-white uppercase tracking-widest">{rm.images[3].caption}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Walkthrough (concept) ─────────────────────────────────────────────────
function WalkthroughSlide({ project: p }: { project: Project }) {
  const rooms = p.analysis?.rooms ?? [];
  return (
    <div className="w-full h-full bg-[#1a1917] flex flex-col overflow-hidden" style={{ animation: "fadeIn .4s ease" }}>
      <div className="px-8 sm:px-16 pt-8 flex-shrink-0">
        <p className="font-mono text-[10px] tracking-[0.25em] text-amber-500/80 uppercase">A Walk Through Your Home</p>
        <p className="text-white/40 text-sm mt-1">Every space has been designed with purpose.</p>
      </div>
      <div className="flex-1 overflow-y-auto px-8 sm:px-16 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-5">
          {rooms.map((room) => {
            const n = room.name.toLowerCase();
            const icon = n.includes("bed") ? "🛏" : n.includes("kitchen") ? "🍳" : n.includes("living") || n.includes("drawing") ? "🛋" :
              n.includes("pooja") || n.includes("puja") ? "🕉" : n.includes("toilet") || n.includes("bath") ? "🚿" :
              n.includes("dining") ? "🍽" : n.includes("stair") || n.includes("lift") ? "⬆" : "◻";
            return (
              <div key={room.name} className="flex gap-3">
                <span className="text-lg mt-0.5 flex-shrink-0 opacity-60">{icon}</span>
                <div className="min-w-0">
                  <p className="text-white/90 text-sm font-medium">{room.name}</p>
                  {room.sizeEstimateSqm && <p className="text-white/30 text-xs font-mono">{room.sizeEstimateSqm} m2</p>}
                  <p className="text-white/50 text-xs leading-relaxed mt-0.5">
                    {room.orientation ? `${room.orientation}-facing. ` : ""}
                    {room.specialFeatures?.slice(0, 2).join(", ") ?? ""}
                    {room.adjacentRooms?.length ? ` Connected to ${room.adjacentRooms.slice(0, 2).join(" and ")}.` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Highlights (concept) ────────────────────────────────────────────────────
function HighlightsSlide({ project: p }: { project: Project }) {
  const rooms = p.analysis?.rooms ?? [];
  const facing = p.plotInfo?.facing ?? "";

  const insights: { title: string; detail: string }[] = [];

  const bedrooms = rooms.filter(r => r.name.toLowerCase().includes("bed"));
  const living = rooms.filter(r => r.name.toLowerCase().includes("living") || r.name.toLowerCase().includes("drawing"));
  if (bedrooms.length > 0 && living.length > 0) {
    insights.push({ title: "Private + Social Zones", detail: `${bedrooms.length} bedroom${bedrooms.length > 1 ? "s" : ""} separated from ${living.length} social space${living.length > 1 ? "s" : ""} — privacy when you need it.` });
  }
  if (facing) {
    const f = facing.toLowerCase();
    insights.push({ title: `${facing}-Facing`, detail: f.includes("east") ? "Morning sun in living areas — naturally bright without harsh glare." : f.includes("north") ? "Consistent daylight throughout the day." : `${facing} orientation — designed for comfort.` });
  }
  const suites = bedrooms.filter(b => (b.adjacentRooms ?? []).some(a => a.toLowerCase().includes("dress") || a.toLowerCase().includes("toilet")));
  if (suites.length > 0) {
    insights.push({ title: `${suites.length} Self-Contained Suite${suites.length > 1 ? "s" : ""}`, detail: "Bedroom + dressing + bathroom — no sharing, no morning queues." });
  }
  const hasServiceKit = rooms.some(r => r.name.toLowerCase().includes("serv"));
  if (hasServiceKit) {
    insights.push({ title: "Dual Kitchen", detail: "Main kitchen for family, service kitchen for heavy-duty — keeps the main space clean." });
  }
  const pooja = rooms.find(r => r.name.toLowerCase().includes("pooja") || r.name.toLowerCase().includes("puja"));
  if (pooja) {
    insights.push({ title: "Dedicated Pooja Room", detail: "A proper, peaceful prayer space — not a corner of another room." });
  }

  return (
    <div className="w-full h-full bg-[#1a1917] flex flex-col justify-center px-8 sm:px-16" style={{ animation: "fadeIn .4s ease" }}>
      <p className="font-mono text-[10px] tracking-[0.25em] text-amber-500/80 uppercase mb-2">Why This Plan Works</p>
      <p className="text-white/40 text-sm mb-8">Key design decisions that make this home work for everyday life.</p>
      <div className="space-y-6">
        {insights.slice(0, 5).map((item, i) => (
          <div key={i} className="flex gap-4 items-start">
            <span className="font-mono text-amber-500/60 text-sm mt-0.5 w-6 flex-shrink-0">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <p className="text-white/90 text-sm font-medium">{item.title}</p>
              <p className="text-white/45 text-xs leading-relaxed mt-0.5">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Vastu (concept) ─────────────────────────────────────────────────────────
function VastuSlide({ project: p }: { project: Project }) {
  const rooms = p.analysis?.rooms ?? [];
  const facing = (p.plotInfo?.facing ?? "").toLowerCase();

  const checks: { label: string; ideal: string; actual: string; pass: boolean }[] = [];

  const vastuMap: { match: string; ideal: string; test: (o: string) => boolean }[] = [
    { match: "bed", ideal: "South-West", test: o => o.includes("south") || o.includes("west") },
    { match: "kitchen", ideal: "South-East", test: o => o.includes("south") || o.includes("east") },
    { match: "pooja", ideal: "North-East", test: o => o.includes("north") || o.includes("east") },
    { match: "living", ideal: "North/East", test: o => o.includes("north") || o.includes("east") },
    { match: "drawing", ideal: "North/East", test: o => o.includes("north") || o.includes("east") },
  ];

  // Entrance check
  if (facing) {
    const good = facing.includes("east") || facing.includes("north");
    checks.push({ label: "Main Entrance", ideal: "East/North", actual: p.plotInfo?.facing ?? "", pass: good });
  }

  for (const rule of vastuMap) {
    const room = rooms.find(r => r.name.toLowerCase().includes(rule.match));
    if (room?.orientation) {
      checks.push({ label: room.name, ideal: rule.ideal, actual: room.orientation, pass: rule.test(room.orientation.toLowerCase()) });
    }
  }

  const score = checks.length > 0 ? Math.round(checks.filter(c => c.pass).length / checks.length * 100) : 0;

  return (
    <div className="w-full h-full bg-[#1a1917] flex flex-col justify-center px-8 sm:px-16" style={{ animation: "fadeIn .4s ease" }}>
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="font-mono text-[10px] tracking-[0.25em] text-amber-500/80 uppercase">Vastu Analysis</p>
          <p className="text-white/40 text-sm mt-1">Alignment with Vastu Shastra principles.</p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-light text-amber-500/80">{score}%</p>
          <p className="font-mono text-[9px] text-white/30 uppercase tracking-widest">Vastu Score</p>
        </div>
      </div>
      <div className="space-y-3">
        {checks.map((c, i) => (
          <div key={i} className="flex items-center gap-4 py-2 border-b border-white/5">
            <span className={`w-6 text-center text-xs font-medium ${c.pass ? "text-emerald-400" : "text-amber-400/60"}`}>
              {c.pass ? "OK" : "--"}
            </span>
            <div className="flex-1">
              <p className="text-white/80 text-sm">{c.label}</p>
            </div>
            <p className="text-white/30 text-xs font-mono">Ideal: {c.ideal}</p>
            <p className="text-white/50 text-xs font-mono">{c.actual}</p>
          </div>
        ))}
      </div>
      <p className="text-white/20 text-[9px] mt-6">Based on AI-detected room orientations. For detailed Vastu consultation, please consult a certified practitioner.</p>
    </div>
  );
}

// ─── Thank You ───────────────────────────────────────────────────────────────
function ThankYouSlide({ project: p }: { project: Project }) {
  const phone = (p as any).plotInfo?.phone;
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ animation: "fadeIn .4s ease" }}>
      <div className="absolute inset-0 bg-[#1a1917]" />
      <div className="relative text-center px-8 max-w-lg">
        <p className="font-mono text-[10px] tracking-[0.25em] text-amber-500/60 uppercase mb-6">{p.firmName}</p>
        <h2 className="text-3xl sm:text-5xl font-light text-white/90 mb-4" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          Thank you
        </h2>
        <p className="text-white/40 text-sm mb-8">
          We look forward to bringing {p.name} to life.
        </p>

        {phone && (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
            <a href={`tel:${phone}`}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-full px-6 py-3 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
              <span className="text-white/80 text-sm">Call Us</span>
            </a>
            <a href={`https://wa.me/${phone.replace(/[^0-9+]/g, "")}`}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 rounded-full px-6 py-3 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
              <span className="text-white text-sm">WhatsApp Us</span>
            </a>
          </div>
        )}

        <div className="flex items-center justify-center gap-6 text-white/20 text-xs font-mono">
          {p.plotInfo?.city && <span>{p.plotInfo.city}{p.plotInfo.state ? `, ${p.plotInfo.state}` : ""}</span>}
          {p.clientName && <span>Prepared for {p.clientName}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────
function CompassSVG({ facing }: { facing: string }) {
  const cx = 50, cy = 50, r = 38;
  const angles: Record<string, number> = { North: 90, South: 270, East: 0, West: 180, "North-East": 45, "North-West": 135, "South-East": 315, "South-West": 225 };
  const rad = ((angles[facing] ?? 90) * Math.PI) / 180;
  return (
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2ddd8" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r="3" fill="#2d2b27" />
      {(["N","S","E","W"] as const).map((l) => {
        const a = ({ N: 90, S: 270, E: 0, W: 180 }[l]) * Math.PI / 180;
        return <text key={l} x={cx + Math.cos(a)*(r+8)-3} y={cy - Math.sin(a)*(r+8)+4} fontSize="9" fontFamily="monospace" textAnchor="middle" fill={facing.startsWith(l) ? "#2d2b27" : "#c8c2b8"} fontWeight={facing.startsWith(l) ? "bold" : "normal"}>{l}</text>;
      })}
      <line x1={cx} y1={cy} x2={cx + Math.cos(rad)*(r-6)} y2={cy - Math.sin(rad)*(r-6)} stroke="#2d2b27" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function KeyboardHint() {
  const [v, setV] = useState(true);
  useEffect(() => { const t = setTimeout(() => setV(false), 4000); return () => clearTimeout(t); }, []);
  if (!v) return null;
  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full">
      <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest">← → to navigate</p>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-[#111110] flex items-center justify-center" style={{ fontFamily: "'Instrument Sans', system-ui, sans-serif" }}>
      <div className="text-center space-y-4">
        <div className="w-7 h-7 border border-white/20 border-t-white/60 rounded-full animate-spin mx-auto" />
        <p className="font-mono text-xs text-white/25 uppercase tracking-widest">Loading…</p>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  const isExpired  = message.toLowerCase().includes("expired");
  const isDisabled = message.toLowerCase().includes("disabled");
  return (
    <div className="fixed inset-0 bg-[#111110] flex items-center justify-center p-8" style={{ fontFamily: "'Instrument Sans', system-ui, sans-serif" }}>
      <div className="text-center space-y-4 max-w-sm">
        <div className="w-12 h-12 border border-stone-700 rounded-sm flex items-center justify-center mx-auto">
          <span className="text-stone-500 text-lg">{isExpired ? "⏱" : isDisabled ? "🔒" : "✕"}</span>
        </div>
        <div>
          <p className="font-mono text-xs text-stone-500 uppercase tracking-widest mb-2">
            {isExpired ? "Link Expired" : isDisabled ? "Link Disabled" : "Not Found"}
          </p>
          <p className="text-sm text-stone-400 leading-relaxed">{message}</p>
        </div>
        <p className="font-mono text-[10px] text-stone-600">Contact your architect for an updated link.</p>
      </div>
    </div>
  );
}
