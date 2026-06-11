"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StepIndicator } from "@/components/StepIndicator";
import type {
  Project, StyleProfile, OverallMoodboard, RoomMoodboard,
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MoodboardsPage() {
  const { id } = useParams<{ id: string }>();

  const [project,          setProject]          = useState<Project | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [generating,       setGenerating]       = useState(false);
  const [globalError,      setGlobalError]      = useState<string | null>(null);
  const [showWarmup,       setShowWarmup]        = useState(false);
  const [currentStep,      setCurrentStep]      = useState("");

  // Style form
  const [overallStyle, setOverallStyle] = useState<OverallStyle>("Modern");
  const [palette,      setPalette]      = useState<Palette>("NeutralWarm");
  const [budgetVibe,   setBudgetVibe]   = useState<BudgetVibe>("MidRange");
  const [hardNo,       setHardNo]       = useState("");

  // Results
  const [overallMoodboard,  setOverallMoodboard]  = useState<OverallMoodboard | null>(null);
  const [roomMoodboards,    setRoomMoodboards]    = useState<RoomMoodboard[]>([]);
  const [styleSet,          setStyleSet]          = useState(false);

  const STEPS = [
    { num: "1", label: "Upload",     status: "complete" as const },
    { num: "2", label: "Review",     status: "complete" as const },
    { num: "3", label: "Moodboards", status: "active"   as const },
    { num: "4", label: "Export",     status: "pending"  as const },
  ];

  useEffect(() => {
    fetch(`/api/projects/${id}`)
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
        if (p.overallMoodboard)                  setOverallMoodboard(p.overallMoodboard);
        if (p.roomMoodboards && p.roomMoodboards.length > 0) setRoomMoodboards(p.roomMoodboards);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  async function generate() {
    setGenerating(true);
    setGlobalError(null);
    setCurrentStep("Building overall style collage…");

    const warmupTimer = setTimeout(() => setShowWarmup(true), 6000);

    try {
      const styleProfile: StyleProfile = { overallStyle, palette, budgetVibe, hardNo };

      setCurrentStep("Generating overall moodboard…");
      const res = await fetch("/api/moodboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, styleProfile }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Generation failed");
      }

      const data = await res.json();
      setOverallMoodboard(data.overallMoodboard);
      setRoomMoodboards(data.roomMoodboards);
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
        body: JSON.stringify({ projectId: id, styleProfile, rooms: [roomName] }),
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
          Set the interior direction, then we'll build an overall style collage and room-by-room moodboards with plan snippets.
        </p>
      </div>

      {/* Warmup notice */}
      {showWarmup && (
        <div className="mb-6 border border-amber-200 bg-amber-50 rounded-sm px-4 py-3 flex items-start gap-3">
          <span className="text-amber-500 mt-0.5 flex-shrink-0">⏳</span>
          <div>
            <p className="text-sm text-amber-800 font-medium">Working on it…</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Cropping plan snippets and preparing {roomMoodboards.length > 0 ? "additional" : ""} moodboards. This can take 10–20s.
            </p>
          </div>
        </div>
      )}

      {/* Global error */}
      {globalError && (
        <div className="mb-6 border border-red-200 bg-red-50 rounded-sm px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 mt-0.5">✕</span>
          <div>
            <p className="text-sm text-red-700">{globalError}</p>
            <button onClick={() => setGlobalError(null)} className="font-mono text-[10px] text-red-400 mt-1 underline">Dismiss</button>
          </div>
        </div>
      )}

      {/* ── Layout: questionnaire left, results right ─────────────────────── */}
      <div className={`grid gap-8 ${hasResults ? "grid-cols-1 lg:grid-cols-4" : "grid-cols-1 lg:grid-cols-5"}`}>

        {/* ── Style questionnaire ───────────────────────────────────────── */}
        <div className={`space-y-4 fade-up fade-up-2 ${hasResults ? "lg:col-span-1" : "lg:col-span-2"}`}>

          {/* Overall style */}
          <div className="card p-4 space-y-3">
            <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase">01 — Style</p>
            <div className="grid grid-cols-2 gap-1.5">
              {STYLE_OPTIONS.map((opt) => (
                <button key={opt.value} type="button"
                  disabled={generating}
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

          {/* Palette */}
          <div className="card p-4 space-y-3">
            <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase">02 — Palette</p>
            <div className="space-y-1.5">
              {PALETTE_OPTIONS.map((opt) => (
                <button key={opt.value} type="button"
                  disabled={generating}
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

          {/* Budget */}
          <div className="card p-4 space-y-3">
            <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase">03 — Budget</p>
            <div className="grid grid-cols-3 gap-1.5">
              {BUDGET_OPTIONS.map((opt) => (
                <button key={opt.value} type="button"
                  disabled={generating}
                  onClick={() => setBudgetVibe(opt.value)}
                  className={`text-center p-2.5 border rounded-sm transition-all disabled:opacity-50 ${
                    budgetVibe === opt.value ? "border-stone-900 bg-white" : "border-stone-200 hover:border-stone-400"
                  }`}>
                  <p className="font-mono text-[9px] uppercase tracking-wider text-stone-800">{opt.label}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Hard no */}
          <div className="card p-4 space-y-2">
            <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase">04 — Avoid</p>
            <textarea className="field-input text-sm resize-none" rows={2}
              placeholder="e.g. no marble, no dark wood"
              value={hardNo} onChange={(e) => setHardNo(e.target.value)}
              disabled={generating} />
          </div>

          {/* Generate button */}
          <button onClick={generate} disabled={generating} className="btn-primary w-full justify-center">
            {generating ? (
              <><span className="spinner" /><span>{currentStep || "Generating…"}</span></>
            ) : hasResults
              ? "↻ Regenerate All"
              : "Generate Moodboards →"}
          </button>
        </div>

        {/* ── Results ───────────────────────────────────────────────────── */}
        <div className={`space-y-10 fade-up fade-up-3 ${hasResults ? "lg:col-span-3" : "lg:col-span-3"}`}>

          {/* Empty state */}
          {!hasResults && !generating && (
            <div className="h-80 border border-dashed border-stone-200 rounded-sm flex flex-col items-center justify-center text-center p-12 space-y-3">
              <p className="font-mono text-xs text-stone-400 uppercase tracking-widest">Moodboards will appear here</p>
              <p className="text-xs text-stone-400 max-w-xs leading-relaxed">
                Choose your style on the left, then click Generate Moodboards.
                We'll create an overall style collage plus room-by-room references with plan snippets.
              </p>
            </div>
          )}

          {/* Generating skeleton */}
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
                  <p className="font-mono text-xs uppercase tracking-widest text-stone-700">
                    Overall Interior Style
                  </p>
                  <p className="text-xs text-stone-400 mt-0.5 italic">{overallMoodboard.styleStatement}</p>
                </div>
              </div>

              {/* 2+2 grid collage */}
              <div className="grid grid-cols-2 gap-2">
                {overallMoodboard.images.slice(0, 4).map((img, i) => (
                  <div key={i} className="group relative overflow-hidden rounded-sm aspect-video">
                    <img src={img.url} alt={img.caption}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span className="absolute bottom-2 left-3 font-mono text-[10px] text-white uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                      {img.caption}
                    </span>
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
                />
              ))}
            </section>
          )}

          {/* Continue CTA */}
          {hasResults && !generating && (
            <div className="flex justify-end pt-4 border-t border-stone-200">
              <a href={`/project/${id}/export`} className="btn-primary">
                Review & Export →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Room Section ─────────────────────────────────────────────────────────────

function RoomSection({
  room,
  project,
  onRegenerate,
}: {
  room: RoomMoodboard;
  project: Project;
  onRegenerate: () => void;
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
      {/* Room header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="font-mono text-sm uppercase tracking-widest text-stone-800 font-medium">
            {room.roomName}
          </p>
          {roomDetail?.sizeEstimateSqm && (
            <span className="font-mono text-[10px] text-stone-400 border border-stone-200 px-2 py-0.5 rounded-sm">
              ~{roomDetail.sizeEstimateSqm} m²
            </span>
          )}
          {roomDetail?.orientation && (
            <span className="font-mono text-[10px] text-stone-400 hidden sm:inline">
              {roomDetail.orientation}
            </span>
          )}
        </div>
        <button onClick={handleRegenerate} disabled={regenerating}
          className="btn-ghost text-[10px]">
          {regenerating ? <><span className="spinner w-3 h-3" style={{borderWidth:1}} /> Regenerating…</> : "↻ Regenerate"}
        </button>
      </div>

      {/* Plan snippet + image grid */}
      <div className="grid grid-cols-4 gap-2 items-start">

        {/* Plan snippet — col 1 */}
        <div className="col-span-1">
          <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-1.5">Plan</p>
          {room.planSnippetUrl ? (
            <div className="border border-stone-200 rounded-sm overflow-hidden bg-white">
              <img src={room.planSnippetUrl} alt={`${room.roomName} plan`}
                className="w-full object-contain"
                style={{ imageRendering: "crisp-edges", maxHeight: "160px" }} />
              <div className="px-2 py-1.5 border-t border-stone-100">
                <p className="font-mono text-[9px] text-stone-400 truncate">{room.roomName}</p>
                {roomDetail?.sizeEstimateSqm && (
                  <p className="font-mono text-[9px] text-stone-300">{roomDetail.sizeEstimateSqm} m²</p>
                )}
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-stone-200 rounded-sm flex items-center justify-center bg-stone-50 h-32">
              <p className="font-mono text-[9px] text-stone-300 uppercase text-center px-2">Plan snippet unavailable</p>
            </div>
          )}

          {/* Special features */}
          {roomDetail?.specialFeatures && roomDetail.specialFeatures.length > 0 && (
            <div className="mt-2 space-y-1">
              {roomDetail.specialFeatures.slice(0, 3).map((f) => (
                <span key={f} className="block font-mono text-[9px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-sm truncate">
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Mood images — cols 2-4 */}
        <div className="col-span-3">
          <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-1.5">Moodboard</p>
          <div className="grid grid-cols-3 gap-2">
            {room.images.slice(0, 3).map((img, i) => (
              <MoodImageTile key={i} img={img} index={i} isHero={i === 0} />
            ))}
          </div>
          {/* 4th image as a wide strip if present */}
          {room.images[3] && (
            <div className="mt-2 group relative overflow-hidden rounded-sm" style={{ height: "80px" }}>
              <img src={room.images[3].url} alt={room.images[3].caption}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent" />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-white uppercase tracking-widest">
                {room.images[3].caption}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Single mood image tile ───────────────────────────────────────────────────

function MoodImageTile({
  img, index, isHero,
}: {
  img: { url: string; caption?: string };
  index: number;
  isHero: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error,  setError]  = useState(false);

  return (
    <div className={`group relative overflow-hidden rounded-sm ${isHero ? "row-span-1" : ""}`}
      style={{ aspectRatio: "4/3" }}>
      {!loaded && !error && <div className="absolute inset-0 skeleton" />}
      {error ? (
        <div className="absolute inset-0 bg-stone-100 flex items-center justify-center">
          <p className="font-mono text-[9px] text-stone-300">Failed to load</p>
        </div>
      ) : (
        <img src={img.url} alt={img.caption ?? `Image ${index + 1}`}
          className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      {img.caption && (
        <span className="absolute bottom-2 left-2 font-mono text-[9px] text-white uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
          {img.caption}
        </span>
      )}
    </div>
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
      {colors[palette].map((c, i) => (
        <div key={i} className="w-3 h-6 rounded-sm" style={{ backgroundColor: c }} />
      ))}
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
