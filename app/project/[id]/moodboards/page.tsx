"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StepIndicator } from "@/components/StepIndicator";
import type { Project, StyleProfile, Moodboard, OverallStyle, Palette, BudgetVibe } from "@/types";

const STYLE_OPTIONS: { value: OverallStyle; desc: string }[] = [
  { value: "Modern",       desc: "Clean lines, minimal ornamentation" },
  { value: "Contemporary", desc: "Current trends, mixed materials" },
  { value: "Scandinavian", desc: "Functional, warm minimalism" },
  { value: "Minimal",      desc: "Stripped-back, serene spaces" },
  { value: "Industrial",   desc: "Raw materials, urban edge" },
  { value: "Classic",      desc: "Timeless elegance, refined detail" },
];

const PALETTE_OPTIONS: { value: Palette; label: string; desc: string }[] = [
  { value: "LightAiry",   label: "Light & Airy",    desc: "Whites, creams, soft pastels" },
  { value: "NeutralWarm", label: "Neutral & Warm",   desc: "Beiges, terracottas, earthy tones" },
  { value: "DarkMoody",   label: "Dark & Moody",     desc: "Charcoals, deep greens, rich hues" },
];

const BUDGET_OPTIONS: { value: BudgetVibe; label: string; desc: string }[] = [
  { value: "Practical", label: "Practical", desc: "Smart, cost-effective choices" },
  { value: "MidRange",  label: "Mid-Range", desc: "Quality materials, thoughtful details" },
  { value: "Premium",   label: "Premium",   desc: "Luxury finishes, bespoke pieces" },
];

// Per-room generation status
interface RoomStatus {
  roomName: string;
  state: "idle" | "generating" | "done" | "error";
  error?: string;
}

export default function MoodboardsPage() {
  const { id } = useParams<{ id: string }>();

  const [project,  setProject]  = useState<Project | null>(null);
  const [loading,  setLoading]  = useState(true);

  // Style form
  const [overallStyle, setOverallStyle] = useState<OverallStyle>("Modern");
  const [palette,      setPalette]      = useState<Palette>("NeutralWarm");
  const [budgetVibe,   setBudgetVibe]   = useState<BudgetVibe>("MidRange");
  const [hardNo,       setHardNo]       = useState("");

  // Moodboard state
  const [moodboards,      setMoodboards]      = useState<Moodboard[]>([]);
  const [roomStatuses,    setRoomStatuses]    = useState<RoomStatus[]>([]);
  const [globalError,     setGlobalError]     = useState<string | null>(null);
  const [styleSet,        setStyleSet]        = useState(false);
  const [generatingAll,   setGeneratingAll]   = useState(false);

  // HF-specific: show warmup notice if generation takes >8s
  const [showWarmupNotice, setShowWarmupNotice] = useState(false);

  const STEPS = [
    { num: "1", label: "Upload",     status: "complete" as const },
    { num: "2", label: "Review",     status: "complete" as const },
    { num: "3", label: "Moodboards", status: "active"   as const },
    { num: "4", label: "Export",     status: "pending"  as const },
  ];

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        const p: Project = d.project;
        setProject(p);
        if (p.styleProfile) {
          setOverallStyle(p.styleProfile.overallStyle);
          setPalette(p.styleProfile.palette);
          setBudgetVibe(p.styleProfile.budgetVibe);
          setHardNo(p.styleProfile.hardNo ?? "");
          setStyleSet(true);
        }
        if (p.moodboards && p.moodboards.length > 0) {
          setMoodboards(p.moodboards);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // ── Generate all moodboards (one room at a time for live updates) ─────────
  async function generateAll() {
    if (!project?.analysis) return;
    setGeneratingAll(true);
    setGlobalError(null);
    setShowWarmupNotice(false);

    const styleProfile: StyleProfile = { overallStyle, palette, budgetVibe, hardNo };

    // Determine target rooms from analysis
    const KEY_ROOMS = ["Living Room", "Kitchen", "Master Bedroom"];
    const detectedNames = project.analysis.rooms.map((r) => r.name);
    const targetRooms = KEY_ROOMS.filter((kr) =>
      detectedNames.some((dn) => dn.toLowerCase().includes(kr.toLowerCase()))
    );
    const finalRooms = targetRooms.length > 0 ? targetRooms : detectedNames.slice(0, 3);

    // Initialise all rooms as "generating"
    setRoomStatuses(finalRooms.map((name) => ({ roomName: name, state: "generating" })));

    // Show warmup notice after 8 seconds if still going
    const warmupTimer = setTimeout(() => setShowWarmupNotice(true), 8000);

    let anySuccess = false;

    // Generate rooms sequentially — HF free tier handles one at a time better
    const newMoodboards: Moodboard[] = [...moodboards.filter((m) => !finalRooms.includes(m.roomName))];

    for (const roomName of finalRooms) {
      try {
        const res = await fetch("/api/moodboards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: id, styleProfile, rooms: [roomName] }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(errData.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        // Extract the newly generated moodboard for this room
        const generated = (data.moodboards as Moodboard[]).find((m) => m.roomName === roomName);
        if (generated) {
          newMoodboards.push(generated);
          setMoodboards([...newMoodboards]);
          anySuccess = true;
        }

        setRoomStatuses((prev) =>
          prev.map((s) => s.roomName === roomName ? { ...s, state: "done" } : s)
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        setRoomStatuses((prev) =>
          prev.map((s) => s.roomName === roomName ? { ...s, state: "error", error: msg } : s)
        );
      }
    }

    clearTimeout(warmupTimer);
    setShowWarmupNotice(false);

    if (anySuccess) {
      setStyleSet(true);
      setProject((p) => p ? { ...p, status: "styled" } : p);
    } else {
      setGlobalError("All rooms failed to generate. Check your HF_TOKEN or try again.");
    }

    setGeneratingAll(false);
  }

  // ── Regenerate a single room ───────────────────────────────────────────────
  async function regenerateRoom(roomName: string) {
    setRoomStatuses((prev) => {
      const existing = prev.find((s) => s.roomName === roomName);
      if (existing) return prev.map((s) => s.roomName === roomName ? { ...s, state: "generating", error: undefined } : s);
      return [...prev, { roomName, state: "generating" }];
    });

    // Show warmup notice after 8s for single room too
    const warmupTimer = setTimeout(() => setShowWarmupNotice(true), 8000);

    try {
      const res = await fetch("/api/moodboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: id,
          styleProfile: { overallStyle, palette, budgetVibe, hardNo },
          rooms: [roomName],
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      setMoodboards(data.moodboards as Moodboard[]);
      setRoomStatuses((prev) =>
        prev.map((s) => s.roomName === roomName ? { ...s, state: "done" } : s)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Regeneration failed";
      setRoomStatuses((prev) =>
        prev.map((s) => s.roomName === roomName ? { ...s, state: "error", error: msg } : s)
      );
    } finally {
      clearTimeout(warmupTimer);
      setShowWarmupNotice(false);
    }
  }

  if (loading)  return <PageSkeleton />;
  if (!project) return <div className="p-12 text-center text-stone-400">Project not found.</div>;
  if (!project.analysis) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center space-y-4">
        <p className="text-stone-500">Please complete plan analysis first.</p>
        <a href={`/project/${id}/review`} className="btn-primary inline-flex">Go to Review</a>
      </div>
    );
  }

  const isAnyGenerating = roomStatuses.some((s) => s.state === "generating");
  const doneCount       = roomStatuses.filter((s) => s.state === "done").length;
  const totalCount      = roomStatuses.length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10 fade-up fade-up-1">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <StepIndicator steps={STEPS} />
        </div>
        <h1 className="font-display text-4xl font-light text-stone-900 mb-2"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          Style & Moodboards
        </h1>
        <p className="text-stone-500 text-sm">
          Tell us the design direction and we'll generate interior moodboards for each key room.
        </p>
      </div>

      {/* HF warmup notice */}
      {showWarmupNotice && (
        <div className="mb-6 border border-amber-200 bg-amber-50 rounded-sm px-4 py-3 flex items-start gap-3 fade-up fade-up-1">
          <span className="text-amber-500 mt-0.5 flex-shrink-0">⏳</span>
          <div>
            <p className="text-sm text-amber-800 font-medium">AI model warming up</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Hugging Face free tier models have cold starts — first image can take 20–40 seconds.
              Subsequent rooms will be faster. Please wait.
            </p>
          </div>
        </div>
      )}

      {/* Global error */}
      {globalError && (
        <div className="mb-6 border border-red-200 bg-red-50 rounded-sm px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 mt-0.5 flex-shrink-0">✕</span>
          <div className="flex-1">
            <p className="text-sm text-red-700">{globalError}</p>
            <button type="button" onClick={() => setGlobalError(null)}
              className="font-mono text-[10px] text-red-500 mt-1 underline">Dismiss</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

        {/* ── Left: Style questionnaire ────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5 fade-up fade-up-2">

          {/* Overall style */}
          <div className="card p-5 space-y-4">
            <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">01 — Overall Style</p>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" onClick={() => setOverallStyle(opt.value)}
                  disabled={isAnyGenerating}
                  className={`text-left p-3 border rounded-sm transition-all disabled:opacity-50 ${
                    overallStyle === opt.value ? "border-stone-900 bg-white" : "border-stone-200 hover:border-stone-400"
                  }`}>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-stone-800 mb-0.5">{opt.value}</p>
                  <p className="text-[10px] text-stone-400">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Palette */}
          <div className="card p-5 space-y-4">
            <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">02 — Colour Palette</p>
            <div className="space-y-2">
              {PALETTE_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" onClick={() => setPalette(opt.value)}
                  disabled={isAnyGenerating}
                  className={`w-full text-left p-3 border rounded-sm transition-all flex items-center gap-3 disabled:opacity-50 ${
                    palette === opt.value ? "border-stone-900 bg-white" : "border-stone-200 hover:border-stone-400"
                  }`}>
                  <PaletteSwatch palette={opt.value} />
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-stone-800">{opt.label}</p>
                    <p className="text-[10px] text-stone-400">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Budget */}
          <div className="card p-5 space-y-4">
            <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">03 — Budget Vibe</p>
            <div className="grid grid-cols-3 gap-2">
              {BUDGET_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" onClick={() => setBudgetVibe(opt.value)}
                  disabled={isAnyGenerating}
                  className={`text-center p-3 border rounded-sm transition-all disabled:opacity-50 ${
                    budgetVibe === opt.value ? "border-stone-900 bg-white" : "border-stone-200 hover:border-stone-400"
                  }`}>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-stone-800 mb-0.5">{opt.label}</p>
                  <p className="text-[10px] text-stone-400 leading-tight">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Hard no */}
          <div className="card p-5 space-y-3">
            <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">04 — Hard No (optional)</p>
            <p className="text-[11px] text-stone-400">Anything to avoid in the interiors?</p>
            <textarea className="field-input text-sm resize-none" rows={2}
              placeholder="e.g. no bright colours, no marble, no dark wood"
              value={hardNo} onChange={(e) => setHardNo(e.target.value)}
              disabled={isAnyGenerating} />
          </div>

          {/* Generate button + progress */}
          <div className="space-y-3">
            <button onClick={generateAll} disabled={generatingAll}
              className="btn-primary w-full justify-center">
              {generatingAll ? (
                <><span className="spinner" />
                  <span>
                    {totalCount > 0
                      ? `Generating ${doneCount + 1} of ${totalCount}…`
                      : "Starting…"}
                  </span>
                </>
              ) : styleSet && moodboards.length > 0
                ? "↻ Regenerate All Moodboards"
                : "Generate Moodboards →"}
            </button>

            {/* Progress bar while generating */}
            {generatingAll && totalCount > 0 && (
              <div>
                <div className="progress-bar">
                  <div className="progress-bar-fill"
                    style={{ width: `${(doneCount / totalCount) * 100}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  {roomStatuses.map((s) => (
                    <div key={s.roomName} className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        s.state === "done"       ? "bg-amber-500" :
                        s.state === "generating" ? "bg-stone-400 animate-pulse" :
                        s.state === "error"      ? "bg-red-400" :
                        "bg-stone-200"
                      }`} />
                      <span className="font-mono text-[9px] text-stone-400 uppercase truncate max-w-[60px]">
                        {s.roomName.split(" ")[0]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Provider hint */}
            <p className="font-mono text-[9px] text-stone-400 text-center leading-relaxed">
              {process.env.NODE_ENV === "development"
                ? "Set HF_TOKEN in .env.local for real AI images"
                : "Powered by Hugging Face FLUX · Free tier"}
            </p>
          </div>
        </div>

        {/* ── Right: Moodboard tiles ───────────────────────────────────── */}
        <div className="lg:col-span-3 fade-up fade-up-3">
          {moodboards.length === 0 && !generatingAll ? (
            <EmptyMoodboardsState />
          ) : (
            <div className="space-y-6">
              <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">
                Generated Moodboards
              </p>

              {/* Rooms currently being generated (skeleton placeholders) */}
              {roomStatuses.filter((s) => s.state === "generating" && !moodboards.find((m) => m.roomName === s.roomName)).map((s) => (
                <GeneratingPlaceholder key={s.roomName} roomName={s.roomName} />
              ))}

              {/* Completed moodboards */}
              {moodboards.map((mb) => {
                const status = roomStatuses.find((s) => s.roomName === mb.roomName);
                const roomDetail = project.analysis?.rooms.find((r) => r.name === mb.roomName);
                return (
                  <MoodboardTile
                    key={mb.roomName}
                    moodboard={mb}
                    roomDetail={roomDetail}
                    isRegenerating={status?.state === "generating"}
                    error={status?.state === "error" ? status.error : undefined}
                    onRegenerate={() => regenerateRoom(mb.roomName)}
                  />
                );
              })}

              {/* Error rooms that have no image yet */}
              {roomStatuses.filter((s) => s.state === "error" && !moodboards.find((m) => m.roomName === s.roomName)).map((s) => (
                <RoomErrorTile
                  key={s.roomName}
                  roomName={s.roomName}
                  error={s.error}
                  onRetry={() => regenerateRoom(s.roomName)}
                />
              ))}

              {/* Continue CTA */}
              {moodboards.length > 0 && !generatingAll && (
                <div className="pt-2 flex justify-end">
                  <a href={`/project/${id}/export`} className="btn-primary">
                    <span>Review & Export</span><span>→</span>
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MoodboardTile({
  moodboard,
  roomDetail,
  isRegenerating,
  error,
  onRegenerate,
}: {
  moodboard: Moodboard;
  roomDetail?: { sizeEstimateSqm?: number; orientation?: string; specialFeatures?: string[] };
  isRegenerating: boolean;
  error?: string;
  onRegenerate: () => void;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError,  setImgError]  = useState(false);

  // Reset img state when URL changes (new generation)
  useEffect(() => { setImgLoaded(false); setImgError(false); }, [moodboard.imageUrl]);

  return (
    <div className="space-y-2">
      {/* Room header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-mono text-xs uppercase tracking-widest text-stone-600">{moodboard.roomName}</p>
          {roomDetail?.sizeEstimateSqm && (
            <span className="font-mono text-[9px] text-stone-400 border border-stone-200 px-1.5 py-0.5 rounded-sm">
              ~{roomDetail.sizeEstimateSqm} m²
            </span>
          )}
          {roomDetail?.orientation && (
            <span className="font-mono text-[9px] text-stone-400 hidden sm:inline">{roomDetail.orientation}</span>
          )}
        </div>
        <button onClick={onRegenerate} disabled={isRegenerating} className="btn-ghost text-[10px]">
          {isRegenerating ? (
            <><span className="spinner w-3 h-3" style={{ borderWidth: 1 }} /><span>Generating…</span></>
          ) : "↻ Regenerate"}
        </button>
      </div>

      {/* Error state on existing tile */}
      {error && (
        <div className="border border-red-100 bg-red-50 rounded-sm px-3 py-2 text-xs text-red-600">
          Failed to regenerate: {error}
        </div>
      )}

      {/* Image */}
      <div className="moodboard-tile aspect-video overflow-hidden relative">
        {isRegenerating && (
          <div className="absolute inset-0 bg-stone-100 flex flex-col items-center justify-center gap-3 z-10">
            <span className="spinner w-6 h-6 text-stone-400" style={{ borderWidth: 1.5 }} />
            <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">Generating…</p>
          </div>
        )}
        {!imgLoaded && !isRegenerating && !imgError && (
          <div className="absolute inset-0 skeleton" />
        )}
        {imgError ? (
          <div className="absolute inset-0 bg-stone-100 flex flex-col items-center justify-center gap-2">
            <p className="font-mono text-[10px] text-stone-400">Image failed to load</p>
            <button onClick={onRegenerate} className="btn-ghost text-[10px]">↻ Retry</button>
          </div>
        ) : (
          <img src={moodboard.imageUrl} alt={`${moodboard.roomName} moodboard`}
            className={`w-full h-full object-cover transition-opacity duration-500 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)} />
        )}
        <div className="overlay" />
      </div>

      {/* Special features */}
      {roomDetail?.specialFeatures && roomDetail.specialFeatures.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {roomDetail.specialFeatures.map((f) => (
            <span key={f} className="font-mono text-[9px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-sm">
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GeneratingPlaceholder({ roomName }: { roomName: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-widest text-stone-600">{roomName}</p>
        <span className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">Generating…</span>
      </div>
      <div className="aspect-video bg-stone-100 rounded-sm flex flex-col items-center justify-center gap-3 border border-stone-200">
        <span className="spinner w-6 h-6 text-stone-400" style={{ borderWidth: 1.5 }} />
        <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest animate-pulse">
          Building moodboard…
        </p>
      </div>
    </div>
  );
}

function RoomErrorTile({ roomName, error, onRetry }: { roomName: string; error?: string; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-xs uppercase tracking-widest text-stone-600">{roomName}</p>
      <div className="aspect-video border border-red-100 bg-red-50 rounded-sm flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-mono text-[10px] text-red-500 uppercase tracking-widest">Generation failed</p>
        {error && <p className="text-xs text-red-400 max-w-xs leading-relaxed">{error}</p>}
        <button onClick={onRetry} className="btn-secondary text-xs">↻ Try again</button>
      </div>
    </div>
  );
}

function EmptyMoodboardsState() {
  return (
    <div className="h-full min-h-[400px] border border-dashed border-stone-200 rounded-sm flex flex-col items-center justify-center text-center p-12 space-y-4">
      <div className="w-10 h-10 border border-stone-200 rounded-sm flex items-center justify-center">
        <svg className="w-5 h-5 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 002 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="font-mono text-xs text-stone-400 uppercase tracking-widest">Moodboards will appear here</p>
      <p className="text-xs text-stone-400 max-w-xs leading-relaxed">
        Set your style preferences on the left, then click Generate Moodboards.
      </p>
      <p className="font-mono text-[9px] text-stone-300 leading-relaxed max-w-[200px]">
        First generation may take 20–40s on free tier while the AI model warms up.
      </p>
    </div>
  );
}

function PaletteSwatch({ palette }: { palette: Palette }) {
  const colors: Record<Palette, string[]> = {
    LightAiry:   ["#f9f7f4", "#e8e4dc", "#d4cec4"],
    NeutralWarm: ["#c4a882", "#b08860", "#8b6540"],
    DarkMoody:   ["#2d2d2d", "#1a3a2a", "#3d2a1a"],
  };
  return (
    <div className="flex gap-0.5 flex-shrink-0">
      {colors[palette].map((c, i) => (
        <div key={i} className="w-4 h-7 rounded-sm" style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-8">
      <div className="skeleton h-6 w-64" />
      <div className="skeleton h-8 w-48" />
      <div className="grid grid-cols-5 gap-8">
        <div className="col-span-2 space-y-4">
          <div className="skeleton h-64" /><div className="skeleton h-48" />
        </div>
        <div className="col-span-3 skeleton h-[520px]" />
      </div>
    </div>
  );
}
