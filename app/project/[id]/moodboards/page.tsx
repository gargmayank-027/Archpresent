"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StepIndicator } from "@/components/StepIndicator";
import type {
  Project, StyleProfile, OverallMoodboard, RoomMoodboard, MoodImage,
  OverallStyle, Palette, BudgetVibe,
} from "@/types";

// ─── Style options ────────────────────────────────────────────────────────────

const STYLE_OPTIONS: { value: OverallStyle; desc: string }[] = [
  { value: "Modern",       desc: "Clean lines, minimal ornamentation" },
  { value: "Contemporary", desc: "Current trends, mixed materials" },
  { value: "Scandinavian", desc: "Functional, warm minimalism" },
  { value: "Minimal",      desc: "Stripped-back, serene spaces" },
  { value: "Industrial",   desc: "Raw materials, urban edge" },
  { value: "Classic",      desc: "Timeless elegance, refined detail" },
];

const PALETTE_OPTIONS: { value: Palette; label: string; desc: string }[] = [
  { value: "LightAiry",   label: "Light & Airy",  desc: "Whites, creams, soft pastels" },
  { value: "NeutralWarm", label: "Neutral & Warm", desc: "Beiges, terracottas, earthy" },
  { value: "DarkMoody",   label: "Dark & Moody",   desc: "Charcoals, deep greens, rich hues" },
];

const BUDGET_OPTIONS: { value: BudgetVibe; label: string }[] = [
  { value: "Practical", label: "Practical" },
  { value: "MidRange",  label: "Mid-Range" },
  { value: "Premium",   label: "Premium" },
];

// Rooms we always try to generate moodboards for
// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MoodboardsPage() {
  const { id } = useParams<{ id: string }>();

  const [project,          setProject]          = useState<Project | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [generating,       setGenerating]       = useState(false);
  const [globalError,      setGlobalError]      = useState<string | null>(null);
  const [showWarmup,       setShowWarmup]       = useState(false);
  const [currentStep,      setCurrentStep]      = useState("");
  const [imagesGenerated,  setImagesGenerated]  = useState(0);
  const [totalImages,      setTotalImages]      = useState(0);

  // Style form
  const [overallStyle, setOverallStyle] = useState<OverallStyle>("Modern");
  const [palette,      setPalette]      = useState<Palette>("NeutralWarm");
  const [budgetVibe,   setBudgetVibe]   = useState<BudgetVibe>("MidRange");
  const [hardNo,       setHardNo]       = useState("");

  // Per-room plain-English context prompts (optional)
  const [contextPrompts, setContextPrompts] = useState<Record<string, string>>({});
  // Room selection — which rooms to include in moodboard generation
  const [selectedRooms, setSelectedRooms]   = useState<Record<string, boolean>>({});

  // Results
  const [overallMoodboard, setOverallMoodboard] = useState<OverallMoodboard | null>(null);
  const [roomMoodboards,   setRoomMoodboards]   = useState<RoomMoodboard[]>([]);
  const [styleSet,         setStyleSet]         = useState(false);
  const [reanalysing,      setReanalysing]      = useState(false);
  const [reanalyseError,   setReanalyseError]   = useState<string | null>(null);

  const STEPS = [
    { num: "1", label: "Upload",     status: "complete" as const },
    { num: "2", label: "Review",     status: "complete" as const },
    { num: "3", label: "Moodboards", status: "active"   as const },
    { num: "4", label: "Export",     status: "pending"  as const },
  ];

  useEffect(() => {
    fetch(`/api/projects/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { project: Project }) => {
        const p = d.project;
        setProject(p);
        if (p.styleProfile) {
          setOverallStyle(p.styleProfile.overallStyle);
          setPalette(p.styleProfile.palette);
          setBudgetVibe(p.styleProfile.budgetVibe);
          setHardNo(p.styleProfile.hardNo ?? "");
          setStyleSet(true);
        }
        if (p.overallMoodboard) setOverallMoodboard(p.overallMoodboard);
        if (p.roomMoodboards && p.roomMoodboards.length > 0) {
          setRoomMoodboards(p.roomMoodboards);
          const prompts: Record<string, string> = {};
          p.roomMoodboards.forEach((rm) => { if (rm.contextPrompt) prompts[rm.roomName] = rm.contextPrompt; });
          setContextPrompts(prompts);
        }
        // Initialise room selection from analysis
        if (p.analysis?.rooms) {
          initRoomSelection(p.analysis.rooms);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // All rooms detected in the plan, sorted by moodboardWorthy first
  function allDetectedRooms() {
    if (!project?.analysis) return [];
    return [...project.analysis.rooms].sort((a, b) => {
      const aw = (a as { moodboardWorthy?: boolean }).moodboardWorthy !== false ? 0 : 1;
      const bw = (b as { moodboardWorthy?: boolean }).moodboardWorthy !== false ? 0 : 1;
      return aw - bw;
    });
  }

  // Which rooms the architect has selected (defaults to moodboardWorthy ones)
  function targetRoomNames(): string[] {
    const all = allDetectedRooms();
    if (all.length === 0) return [];
    // If none explicitly selected yet, default to moodboardWorthy rooms
    const explicitlySelected = Object.keys(selectedRooms).filter((k) => selectedRooms[k]);
    if (explicitlySelected.length > 0) return explicitlySelected;
    const worthy = all.filter((r) => (r as { moodboardWorthy?: boolean }).moodboardWorthy !== false);
    return worthy.length > 0 ? worthy.map((r) => r.name) : all.slice(0, 5).map((r) => r.name);
  }

  // Initialize selectedRooms when project analysis loads
  function initRoomSelection(rooms: typeof project.analysis.rooms) {
    const init: Record<string, boolean> = {};
    rooms.forEach((r) => {
      init[r.name] = (r as { moodboardWorthy?: boolean }).moodboardWorthy !== false;
    });
    setSelectedRooms(init);
  }

  async function generate() {
    setGenerating(true);
    setGlobalError(null);
    setCurrentStep("Finding real interior photos for your style…");

    const warmupTimer = setTimeout(() => setShowWarmup(true), 8000);

    const roomCount = targetRoomNames().length || 3;
    const estimated = 4 + (roomCount * 4);
    setTotalImages(estimated);
    setImagesGenerated(0);

    try {
      const styleProfile: StyleProfile = { overallStyle, palette, budgetVibe, hardNo };

      // Pass the architect's room selection explicitly so the API uses exactly
      // these rooms, not the hardcoded KEY_ROOMS fallback list.
      const selectedRoomNames = targetRoomNames();
      const selectedContextPrompts: Record<string, string> = {};
      selectedRoomNames.forEach((r) => {
        if (contextPrompts[r]) selectedContextPrompts[r] = contextPrompts[r];
      });

      const res = await fetch("/api/moodboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: id,
          styleProfile,
          rooms: selectedRoomNames,
          contextPrompts: selectedContextPrompts,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Generation failed");
      }

      const data = await res.json();
      setOverallMoodboard(data.overallMoodboard);
      setRoomMoodboards(data.roomMoodboards);
      setImagesGenerated(estimated);
      setStyleSet(true);
      setProject((p) => p ? { ...p, status: "styled" } : p);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      clearTimeout(warmupTimer);
      setShowWarmup(false);
      setCurrentStep("");
      setGenerating(false);
    }
  }

  async function regenerateRoom(roomName: string) {
    const styleProfile: StyleProfile = { overallStyle, palette, budgetVibe, hardNo };
    const warmupTimer = setTimeout(() => setShowWarmup(true), 6000);

    try {
      const res = await fetch("/api/moodboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: id, styleProfile, rooms: [roomName],
          contextPrompts: { [roomName]: contextPrompts[roomName] ?? "" },
        }),
      });
      if (!res.ok) throw new Error("Regeneration failed");
      const data = await res.json();
      setRoomMoodboards(data.roomMoodboards);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      clearTimeout(warmupTimer);
      setShowWarmup(false);
    }
  }

  // Per-image regenerate: either a different real photo or an AI generation
  async function regenerateImage(roomName: string, imageIndex: number, mode: "photo" | "ai") {
    try {
      const res = await fetch("/api/moodboards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, roomName, imageIndex, mode }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Image regeneration failed");
      }
      const data = await res.json();
      setRoomMoodboards(data.roomMoodboards);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Image regeneration failed");
    }
  }

  async function reanalysePlan() {
    setReanalysing(true);
    setReanalyseError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Re-analysis failed");
      }
      const data = await res.json();
      // Update project with fresh analysis (includes new boundingBox data)
      setProject((p) => p ? { ...p, analysis: data.analysis, status: "analyzed" } : p);
      // Re-initialise room selection with the new (deeper) room list
      if (data.analysis?.rooms) {
        initRoomSelection(data.analysis.rooms);
      }
      setGlobalError(null);
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      setReanalyseError(isTimeout
        ? "Timed out — please try again."
        : err instanceof Error ? err.message : "Re-analysis failed");
    } finally {
      setReanalysing(false);
    }
  }

  if (loading)  return <PageSkeleton />;
  if (!project) return <div className="p-12 text-center text-stone-400">Project not found.</div>;
  if (!project.analysis) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center space-y-4">
        <p className="text-stone-500">Complete plan analysis first.</p>
        <a href={`/project/${id}/review`} className="btn-primary inline-flex">Go to Review →</a>
      </div>
    );
  }

  const hasResults = overallMoodboard !== null || roomMoodboards.length > 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">

      {/* Header */}
      <div className="mb-8 fade-up fade-up-1">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <StepIndicator steps={STEPS} />
        </div>
        <h1 className="font-display text-4xl font-light text-stone-900 mb-2"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          Style & Moodboards
        </h1>
        <p className="text-stone-500 text-sm">
          We start from real, buildable interior photography matched to your style — the same workflow
          most firms already use with Pinterest. Swap any image for another real photo, or regenerate
          with AI for something more conceptual.
        </p>
      </div>

      {/* Progress banner */}
      {generating && (
        <div className="mb-6 border border-stone-200 bg-white rounded-sm px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="spinner w-4 h-4 text-stone-500" style={{ borderWidth: 1.5 }} />
              <p className="text-sm font-medium text-stone-700">{currentStep || "Generating…"}</p>
            </div>
            {totalImages > 0 && imagesGenerated > 0 && (
              <span className="font-mono text-[10px] text-stone-400">{imagesGenerated} / {totalImages} images</span>
            )}
          </div>
          {totalImages > 0 && (
            <div className="progress-bar">
              <div className="progress-bar-fill transition-all duration-1000"
                style={{ width: `${Math.max(5, (imagesGenerated / totalImages) * 100)}%` }} />
            </div>
          )}
          {showWarmup && (
            <p className="text-xs text-stone-400 leading-relaxed">
              Searching real interior photography and generating AI fallbacks where needed — a few seconds per room.
            </p>
          )}
        </div>
      )}

      {/* Global error */}
      {globalError && (
        <div className="mb-6 border border-red-200 bg-red-50 rounded-sm px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 mt-0.5">✕</span>
          <div className="flex-1">
            <p className="text-sm text-red-700">{globalError}</p>
            {globalError.includes("UNSPLASH_NOT_CONFIGURED") && (
              <p className="text-xs text-red-500 mt-1">
                Add <code className="bg-red-100 px-1 rounded">UNSPLASH_ACCESS_KEY</code> to .env.local —
                free, instant, at <a href="https://unsplash.com/developers" target="_blank" rel="noreferrer" className="underline">unsplash.com/developers</a>.
              </p>
            )}
            <button onClick={() => setGlobalError(null)} className="font-mono text-[10px] text-red-400 mt-1 underline">Dismiss</button>
          </div>
        </div>
      )}

      {/* ── Layout: questionnaire left, results right ─────────────────────── */}
      <div className={`grid gap-8 ${hasResults ? "grid-cols-1 lg:grid-cols-4" : "grid-cols-1 lg:grid-cols-5"}`}>

        {/* ── Style questionnaire ───────────────────────────────────────── */}
        <div className={`space-y-4 fade-up fade-up-2 ${hasResults ? "lg:col-span-1" : "lg:col-span-2"}`}>

          <div className="card p-4 space-y-3">
            <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase">01 — Style</p>
            <div className="grid grid-cols-2 gap-1.5">
              {STYLE_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" disabled={generating}
                  onClick={() => setOverallStyle(opt.value)}
                  className={`text-left p-2.5 border rounded-sm transition-all disabled:opacity-50 ${
                    overallStyle === opt.value ? "border-stone-900 bg-white" : "border-stone-200 hover:border-stone-400"
                  }`}>
                  <p className="font-mono text-[9px] uppercase tracking-wider text-stone-800">{opt.value}</p>
                  <p className="text-[9px] text-stone-400 mt-0.5 leading-tight hidden lg:block">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase">02 — Palette</p>
            <div className="space-y-1.5">
              {PALETTE_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" disabled={generating}
                  onClick={() => setPalette(opt.value)}
                  className={`w-full flex items-center gap-2.5 p-2.5 border rounded-sm transition-all disabled:opacity-50 ${
                    palette === opt.value ? "border-stone-900 bg-white" : "border-stone-200 hover:border-stone-400"
                  }`}>
                  <PaletteSwatch palette={opt.value} />
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-wider text-stone-800">{opt.label}</p>
                    <p className="text-[9px] text-stone-400 hidden lg:block">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase">03 — Budget</p>
            <div className="grid grid-cols-3 gap-1.5">
              {BUDGET_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" disabled={generating}
                  onClick={() => setBudgetVibe(opt.value)}
                  className={`text-center p-2.5 border rounded-sm transition-all disabled:opacity-50 ${
                    budgetVibe === opt.value ? "border-stone-900 bg-white" : "border-stone-200 hover:border-stone-400"
                  }`}>
                  <p className="font-mono text-[9px] uppercase tracking-wider text-stone-800">{opt.label}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-4 space-y-2">
            <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase">04 — Avoid</p>
            <textarea className="field-input text-sm resize-none" rows={2}
              placeholder="e.g. no marble, no dark wood"
              value={hardNo} onChange={(e) => setHardNo(e.target.value)}
              disabled={generating} />
          </div>

          {/* Room selector + per-room context prompts */}
          {project.analysis && project.analysis.rooms.length > 0 && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase">05 — Spaces</p>
                <div className="flex gap-2">
                  <button type="button"
                    className="font-mono text-[9px] text-stone-400 hover:text-stone-600 underline"
                    onClick={() => { const a: Record<string, boolean> = {}; allDetectedRooms().forEach((r) => { a[r.name] = true; }); setSelectedRooms(a); }}>
                    All
                  </button>
                  <button type="button"
                    className="font-mono text-[9px] text-stone-400 hover:text-stone-600 underline"
                    onClick={() => { const a: Record<string, boolean> = {}; allDetectedRooms().forEach((r) => { a[r.name] = false; }); setSelectedRooms(a); }}>
                    None
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-stone-400 leading-relaxed">
                Select spaces to include. Add a brief for any space you want to personalise.
              </p>
              <div className="space-y-1.5 max-h-80 filmstrip pr-1">
                {allDetectedRooms().map((room) => {
                  const isWorthy = (room as any).moodboardWorthy !== false;
                  const isSelected = selectedRooms[room.name] ?? isWorthy;
                  return (
                    <div key={room.name} className={`border rounded-sm transition-all ${isSelected ? "border-stone-300 bg-white" : "border-stone-100 bg-stone-50 opacity-50"}`}>
                      <label className="flex items-start gap-2.5 p-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => setSelectedRooms((p) => ({ ...p, [room.name]: e.target.checked }))}
                          disabled={generating}
                          className="mt-0.5 accent-stone-800 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-stone-700 font-medium">{room.name}</span>
                            {room.sizeEstimateSqm && (
                              <span className="font-mono text-[9px] text-stone-400">~{room.sizeEstimateSqm}m²</span>
                            )}
                            {room.orientation && (
                              <span className="font-mono text-[9px] text-stone-400">{room.orientation}</span>
                            )}
                            {!isWorthy && (
                              <span className="font-mono text-[8px] text-stone-300 border border-stone-200 px-1 rounded-sm">utility</span>
                            )}
                          </div>
                          {isSelected && (
                            <textarea
                              className="field-input text-[11px] resize-none mt-1.5 w-full"
                              rows={1}
                              placeholder="Optional brief, e.g. warm wood tones, statement ceiling…"
                              value={contextPrompts[room.name] ?? ""}
                              onChange={(e) => setContextPrompts((p) => ({ ...p, [room.name]: e.target.value }))}
                              disabled={generating}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>
              <p className="font-mono text-[9px] text-stone-400">
                {targetRoomNames().length} space{targetRoomNames().length !== 1 ? "s" : ""} selected for moodboard
              </p>
            </div>
          )}

          <button onClick={generate} disabled={generating || reanalysing} className="btn-primary w-full justify-center">
            {generating ? (
              <><span className="spinner" /><span>{currentStep || "Generating…"}</span></>
            ) : hasResults ? "↻ Regenerate All" : "Generate Moodboards →"}
          </button>

          {/* Re-analyse — updates room data + bounding boxes for plan crops */}
          <div className="pt-2 border-t border-stone-100 space-y-2">
            <button
              onClick={reanalysePlan}
              disabled={reanalysing || generating}
              className="btn-ghost w-full justify-center text-[11px]"
            >
              {reanalysing
                ? <><span className="spinner w-3 h-3" style={{borderWidth:1}} /><span>Re-analysing plan…</span></>
                : "⟳ Re-analyse Plan"}
            </button>
            {reanalyseError && (
              <p className="font-mono text-[10px] text-red-500 text-center">{reanalyseError}</p>
            )}
            {!reanalyseError && !reanalysing && (
              <p className="font-mono text-[9px] text-stone-300 text-center leading-tight">
                Updates room data and enables plan cropping
              </p>
            )}
          </div>
        </div>

        {/* ── Results ───────────────────────────────────────────────────── */}
        <div className="space-y-10 fade-up fade-up-3 lg:col-span-3">

          {!hasResults && !generating && (
            <div className="h-80 border border-dashed border-stone-200 rounded-sm flex flex-col items-center justify-center text-center p-12 space-y-3">
              <p className="font-mono text-xs text-stone-400 uppercase tracking-widest">Moodboards will appear here</p>
              <p className="text-xs text-stone-400 max-w-xs leading-relaxed">
                Choose your style on the left, optionally add room context, then click Generate Moodboards.
                We'll find real interior photos matched to your brief, plus an overall style collage.
              </p>
            </div>
          )}

          {generating && (
            <div className="space-y-8">
              <div className="space-y-3">
                <div className="skeleton h-5 w-48" />
                <div className="skeleton aspect-video w-full" />
              </div>
              {[1,2,3].map((i) => (
                <div key={i} className="space-y-3">
                  <div className="skeleton h-4 w-32" />
                  <div className="grid grid-cols-3 gap-3">
                    <div className="skeleton aspect-video" />
                    <div className="skeleton aspect-video" />
                    <div className="skeleton aspect-video" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Section 1: Overall style moodboard ──────────────────────── */}
          {overallMoodboard && !generating && (
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 rounded-sm" style={{ backgroundColor: "var(--c-accent)" }} />
                <div>
                  <p className="font-mono text-xs uppercase tracking-widest text-stone-700">Overall Interior Style</p>
                  <p className="text-xs text-stone-400 mt-0.5 italic">{overallMoodboard.styleStatement}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {overallMoodboard.images.slice(0, 4).map((img, i) => (
                  <div key={i} className="group relative overflow-hidden rounded-sm aspect-video bg-stone-100">
                    <img src={img.url} alt={img.caption} className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span className="absolute bottom-2 left-3 font-mono text-[10px] text-white uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                      {img.caption}
                    </span>
                    {img.source === "unsplash" && img.photographer && (
                      <PhotoAttribution photographer={img.photographer} photographerUrl={img.photographerUrl} sourceUrl={img.sourceUrl} />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Tag>{overallStyle}</Tag>
                  <Tag>{palette.replace(/([A-Z])/g, " $1").trim()}</Tag>
                  <Tag>{budgetVibe}</Tag>
                </div>
              </div>
            </section>
          )}

          {/* ── Section 2: Per-room moodboards ──────────────────────────── */}
          {roomMoodboards.length > 0 && !generating && (
            <section className="space-y-10">
              <div className="flex items-center gap-4">
                <span className="font-mono text-xs tracking-widest text-stone-400 uppercase">Space by Space</span>
                <div className="flex-1 h-px bg-stone-200" />
              </div>

              {roomMoodboards.map((rm) => (
                <RoomSection
                  key={rm.roomName}
                  room={rm}
                  project={project}
                  onRegenerate={() => regenerateRoom(rm.roomName)}
                  onRegenerateImage={(idx, mode) => regenerateImage(rm.roomName, idx, mode)}
                />
              ))}
            </section>
          )}

          {hasResults && !generating && (
            <div className="flex justify-end pt-4 border-t border-stone-200">
              <a href={`/project/${id}/export`} className="btn-primary">Review & Export →</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Room Section ─────────────────────────────────────────────────────────────

function RoomSection({
  room, project, onRegenerate, onRegenerateImage,
}: {
  room: RoomMoodboard;
  project: Project;
  onRegenerate: () => void;
  onRegenerateImage: (imageIndex: number, mode: "photo" | "ai") => void;
}) {
  const [regenerating, setRegenerating] = useState(false);
  const roomDetail = project.analysis?.rooms.find((r) => r.name === room.roomName);

  async function handleRegenerate() {
    setRegenerating(true);
    await onRegenerate();
    setRegenerating(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="font-mono text-sm uppercase tracking-widest text-stone-800 font-medium">{room.roomName}</p>
          {roomDetail?.sizeEstimateSqm && (
            <span className="font-mono text-[10px] text-stone-400 border border-stone-200 px-2 py-0.5 rounded-sm">
              ~{roomDetail.sizeEstimateSqm} m²
            </span>
          )}
          {roomDetail?.orientation && (
            <span className="font-mono text-[10px] text-stone-400 hidden sm:inline">{roomDetail.orientation}</span>
          )}
        </div>
        <button onClick={handleRegenerate} disabled={regenerating} className="btn-ghost text-[10px]">
          {regenerating ? <><span className="spinner w-3 h-3" style={{borderWidth:1}} /> Regenerating…</> : "↻ Regenerate All"}
        </button>
      </div>

      {room.contextPrompt && (
        <p className="text-xs text-stone-500 italic bg-stone-50 border border-stone-100 rounded-sm px-3 py-2">
          "{room.contextPrompt}"
        </p>
      )}

      <div className="grid grid-cols-4 gap-2 items-start">

        {/* Plan snippet */}
        <div className="col-span-1">
          <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-1.5">Plan</p>
          {room.planSnippetUrl ? (
            <div className="border border-stone-200 rounded-sm overflow-hidden bg-white">
              <img src={room.planSnippetUrl} alt={`${room.roomName} plan`}
                className="w-full object-contain" style={{ imageRendering: "crisp-edges", maxHeight: "160px" }} />
              <div className="px-2 py-1.5 border-t border-stone-100">
                <p className="font-mono text-[9px] text-stone-400 truncate">{room.roomName}</p>
                {roomDetail?.sizeEstimateSqm && <p className="font-mono text-[9px] text-stone-300">{roomDetail.sizeEstimateSqm} m²</p>}
              </div>
            </div>
          ) : (
            <div className="border border-stone-200 rounded-sm overflow-hidden bg-white">
              <img src={project.planImageUrl} alt="Full floor plan"
                className="w-full object-contain" style={{ imageRendering: "crisp-edges", maxHeight: "160px" }} />
              <div className="px-2 py-1.5 border-t border-stone-100">
                <p className="font-mono text-[9px] text-stone-400">Full plan</p>
                <p className="font-mono text-[9px] text-stone-300">{room.roomName} location not isolated</p>
              </div>
            </div>
          )}
          {roomDetail?.specialFeatures && roomDetail.specialFeatures.length > 0 && (
            <div className="mt-2 space-y-1">
              {roomDetail.specialFeatures.slice(0, 3).map((f) => (
                <span key={f} className="block font-mono text-[9px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-sm truncate">{f}</span>
              ))}
            </div>
          )}
        </div>

        {/* Mood images */}
        <div className="col-span-3">
          <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-1.5">Moodboard</p>
          <div className="grid grid-cols-3 gap-2">
            {room.images.slice(0, 3).map((img, i) => (
              <MoodImageTile key={i} img={img} index={i}
                onRegenerate={(mode) => onRegenerateImage(i, mode)} />
            ))}
          </div>
          {room.images[3] && (
            <div className="mt-2">
              <MoodImageTile img={room.images[3]} index={3} wide
                onRegenerate={(mode) => onRegenerateImage(3, mode)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Single mood image tile (with per-image regenerate actions) ──────────────

function MoodImageTile({
  img, index, wide, onRegenerate,
}: {
  img: MoodImage;
  index: number;
  wide?: boolean;
  onRegenerate: (mode: "photo" | "ai") => void;
}) {
  const [loaded, setLoaded]   = useState(false);
  const [error, setError]     = useState(false);
  const [busy, setBusy]       = useState<"photo" | "ai" | null>(null);

  async function handleAction(mode: "photo" | "ai") {
    setBusy(mode);
    setLoaded(false);
    await onRegenerate(mode);
    setBusy(null);
  }

  return (
    <div className={`group relative overflow-hidden rounded-sm bg-stone-100 ${wide ? "" : ""}`}
      style={wide ? { height: "110px" } : { aspectRatio: "4/3" }}>
      {!loaded && !error && <div className="absolute inset-0 skeleton" />}
      {busy && (
        <div className="absolute inset-0 bg-stone-900/60 flex items-center justify-center z-10">
          <span className="spinner w-5 h-5 text-white" style={{ borderWidth: 2 }} />
        </div>
      )}
      {error ? (
        <div className="absolute inset-0 bg-stone-100 flex items-center justify-center">
          <p className="font-mono text-[9px] text-stone-300">Failed to load</p>
        </div>
      ) : (
        <img src={img.url} alt={img.caption ?? `Image ${index + 1}`}
          className={`w-full h-full object-contain transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)} onError={() => setError(true)} />
      )}

      {/* Caption — bottom left, always visible on hover */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      {img.caption && (
        <span className="absolute bottom-2 left-2 font-mono text-[9px] text-white uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity drop-shadow z-0">
          {img.caption}
        </span>
      )}

      {/* Photographer attribution — required by Unsplash API terms */}
      {img.source === "unsplash" && img.photographer && (
        <PhotoAttribution photographer={img.photographer} photographerUrl={img.photographerUrl} sourceUrl={img.sourceUrl} />
      )}

      {/* Source badge */}
      <span className={`absolute top-2 left-2 font-mono text-[8px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity z-10 ${
        img.source === "unsplash" ? "bg-white/90 text-stone-600" : "bg-amber-500/90 text-white"
      }`}>
        {img.source === "unsplash" ? "Real photo" : "AI concept"}
      </span>

      {/* Per-image action buttons — appear on hover */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          type="button"
          onClick={() => handleAction("photo")}
          disabled={!!busy}
          title="Try a different real photo"
          className="w-6 h-6 rounded-sm bg-white/90 hover:bg-white text-stone-600 flex items-center justify-center text-[10px] transition-colors"
        >
          🔀
        </button>
        <button
          type="button"
          onClick={() => handleAction("ai")}
          disabled={!!busy}
          title="Generate with AI instead"
          className="w-6 h-6 rounded-sm bg-white/90 hover:bg-white text-stone-600 flex items-center justify-center text-[10px] transition-colors"
        >
          ✨
        </button>
      </div>
    </div>
  );
}

// ─── Photographer attribution (Unsplash API requirement) ─────────────────────

function PhotoAttribution({
  photographer, photographerUrl, sourceUrl,
}: {
  photographer: string;
  photographerUrl?: string;
  sourceUrl?: string;
}) {
  return (
    <a
      href={photographerUrl ?? sourceUrl ?? "#"}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="absolute bottom-1 right-1.5 font-mono text-[7px] text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity z-10"
    >
      Photo: {photographer}
    </a>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[9px] uppercase tracking-widest text-stone-500 border border-stone-200 px-2 py-0.5 rounded-sm">
      {children}
    </span>
  );
}

function PaletteSwatch({ palette }: { palette: Palette }) {
  const colors: Record<Palette, string[]> = {
    LightAiry:   ["#f9f7f4","#e8e4dc","#d4cec4"],
    NeutralWarm: ["#c4a882","#b08860","#8b6540"],
    DarkMoody:   ["#2d2d2d","#1a3a2a","#3d2a1a"],
  };
  return (
    <div className="flex gap-0.5 flex-shrink-0">
      {colors[palette].map((c, i) => <div key={i} className="w-3 h-6 rounded-sm" style={{ backgroundColor: c }} />)}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-8">
      <div className="skeleton h-6 w-64" /><div className="skeleton h-8 w-48" />
      <div className="grid grid-cols-5 gap-8">
        <div className="col-span-2 space-y-4"><div className="skeleton h-64" /><div className="skeleton h-48" /></div>
        <div className="col-span-3 skeleton h-[520px]" />
      </div>
    </div>
  );
}
