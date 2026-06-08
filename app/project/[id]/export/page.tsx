"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StepIndicator } from "@/components/StepIndicator";
import type { Project } from "@/types";

export default function ExportPage() {
  const { id } = useParams<{ id: string }>();

  const [project,     setProject]     = useState<Project | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [exporting,   setExporting]   = useState(false);
  const [exportDone,  setExportDone]  = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);

  const STEPS = [
    { num: "1", label: "Upload",     status: "complete" as const },
    { num: "2", label: "Review",     status: "complete" as const },
    { num: "3", label: "Moodboards", status: "complete" as const },
    { num: "4", label: "Export",     status: "active"   as const },
  ];

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => { setProject(d.project); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  async function handleExport() {
    setExporting(true);
    setExportDone(false);
    setExportError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
      });
      if (!res.ok) {
        const err = await res.json();
        setExportError(err.error ?? "Export failed — please try again.");
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const slug = project?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ?? "concept";
      a.href = url;
      a.download = `${slug}-concept.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportDone(true);
    } catch {
      setExportError("Network error — please try again.");
    } finally {
      setExporting(false);
    }
  }

  if (loading)  return <PageSkeleton />;
  if (!project) return <div className="p-12 text-center text-stone-400">Project not found.</div>;

  const { analysis, planStrengths = [], moodboards = [], styleProfile } = project;
  const isReady = planStrengths.length > 0;

  // Build slide deck definition for preview
  const slides: SlidePreview[] = [
    {
      type: "cover",
      label: "Cover",
      icon: "⬛",
    },
    ...(project.plotInfo && Object.keys(project.plotInfo).length > 0
      ? [{ type: "site" as const, label: "Site Context", icon: "🧭" }]
      : []),
    {
      type: "plan",
      label: "Floor Plan",
      icon: "📐",
      imageUrl: project.planImageUrl,
    },
    ...(planStrengths.length > 0
      ? [{ type: "strengths" as const, label: "Plan Strengths", icon: "✦" }]
      : []),
    ...moodboards.map((mb) => ({
      type: "moodboard" as const,
      label: mb.roomName,
      icon: "🖼",
      imageUrl: mb.imageUrl,
      roomName: mb.roomName,
    })),
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">

      {/* Header */}
      <div className="mb-8 fade-up fade-up-1">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <StepIndicator steps={STEPS} />
        </div>
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-4xl font-light text-stone-900 mb-1"
                style={{ fontFamily: "'Cormorant Garamond', serif" }}>
              Review & Export
            </h1>
            <p className="text-stone-500 text-sm">
              {slides.length}-slide 16:9 PDF deck — preview each slide below before exporting.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a href={`/project/${id}/moodboards`} className="btn-secondary">
              ← Edit Moodboards
            </a>
            <button onClick={handleExport} disabled={exporting || !isReady} className="btn-primary">
              {exporting ? (
                <><span className="spinner" /><span>Building PDF…</span></>
              ) : (
                <><DownloadIcon /><span>Export PDF Deck</span></>
              )}
            </button>
          </div>
        </div>

        {exportError && (
          <div className="mt-4 border border-red-200 bg-red-50 rounded-sm px-4 py-3 text-sm text-red-600">
            {exportError}
          </div>
        )}
        {exportDone && (
          <div className="mt-4 border border-amber-200 bg-amber-50 rounded-sm px-4 py-3 flex items-center gap-2">
            <span className="text-amber-600">✓</span>
            <span className="text-sm text-amber-700 font-medium">PDF downloaded successfully.</span>
          </div>
        )}
        {!isReady && (
          <div className="mt-4 border border-stone-200 bg-stone-50 rounded-sm px-4 py-3 text-sm text-stone-500">
            Complete plan analysis first before exporting.{" "}
            <a href={`/project/${id}/review`} className="underline underline-offset-2">Go to Review →</a>
          </div>
        )}
      </div>

      {/* ── Main slide preview area ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 fade-up fade-up-2">

        {/* Slide filmstrip — left column */}
        <div className="lg:col-span-1 space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-3">
            Slides ({slides.length})
          </p>
          <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
            {slides.map((slide, i) => (
              <button key={i} type="button"
                onClick={() => setActiveSlide(i)}
                className={`w-full text-left group transition-all ${
                  activeSlide === i
                    ? "ring-1 ring-stone-900"
                    : "hover:ring-1 hover:ring-stone-300"
                }`}>
                {/* Mini 16:9 thumbnail */}
                <div className="aspect-video overflow-hidden rounded-sm relative">
                  <SlideThumbnail slide={slide} project={project} />
                </div>
                <div className="flex items-center justify-between px-1 py-1">
                  <span className={`font-mono text-[9px] uppercase tracking-wider truncate ${
                    activeSlide === i ? "text-stone-800" : "text-stone-400"
                  }`}>
                    {slide.label}
                  </span>
                  <span className="font-mono text-[9px] text-stone-300">{i + 1}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Large slide preview — right 3 columns */}
        <div className="lg:col-span-3 space-y-4">
          <div className="aspect-video rounded-sm overflow-hidden shadow-lg ring-1 ring-stone-200">
            <SlidePreviewLarge slide={slides[activeSlide]} project={project} />
          </div>

          {/* Slide navigation */}
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))}
              disabled={activeSlide === 0}
              className="btn-secondary disabled:opacity-30 py-1.5 px-4 text-xs">
              ← Prev
            </button>
            <span className="font-mono text-xs text-stone-400">
              {activeSlide + 1} / {slides.length}
            </span>
            <button type="button" onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))}
              disabled={activeSlide === slides.length - 1}
              className="btn-secondary disabled:opacity-30 py-1.5 px-4 text-xs">
              Next →
            </button>
          </div>

          {/* Slide detail panel */}
          <SlideDetailPanel slide={slides[activeSlide]} project={project} slideIndex={activeSlide} />
        </div>
      </div>

      {/* ── Deck summary ────────────────────────────────────────────────── */}
      <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 fade-up fade-up-3">
        {[
          { label: "Total Slides",   value: String(slides.length) },
          { label: "Format",         value: "16 : 9" },
          { label: "Plan Strengths", value: String(planStrengths.length) },
          { label: "Moodboards",     value: String(moodboards.length) },
        ].map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <p className="font-display text-3xl font-light text-stone-800 mb-1"
               style={{ fontFamily: "'Cormorant Garamond', serif" }}>
              {s.value}
            </p>
            <p className="font-mono text-[9px] tracking-widest uppercase text-stone-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Export footer ────────────────────────────────────────────────── */}
      <div className="mt-8 flex items-center justify-between pt-6 border-t border-stone-200 fade-up fade-up-4">
        <div className="space-y-0.5">
          <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">
            {project.name}  ·  {project.clientName}
          </p>
          <p className="font-mono text-[10px] text-stone-300">
            {styleProfile ? `${styleProfile.overallStyle}  ·  ${styleProfile.palette.replace(/([A-Z])/g, " $1").trim()}` : ""}
          </p>
        </div>
        <button onClick={handleExport} disabled={exporting || !isReady} className="btn-primary">
          {exporting ? (
            <><span className="spinner" /><span>Building PDF…</span></>
          ) : (
            <><DownloadIcon /><span>Export PDF Deck</span></>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Slide types ──────────────────────────────────────────────────────────────

type SlidePreview = {
  type: "cover" | "site" | "plan" | "strengths" | "moodboard";
  label: string;
  icon: string;
  imageUrl?: string;
  roomName?: string;
};

// ─── Slide thumbnail (mini, in filmstrip) ─────────────────────────────────────

function SlideThumbnail({ slide, project }: { slide: SlidePreview; project: Project }) {
  const base = "w-full h-full absolute inset-0 flex items-center justify-center";
  const { planStrengths = [], moodboards = [] } = project;

  if (slide.type === "cover") {
    return (
      <div className="w-full h-full bg-stone-800 relative">
        <div className="absolute inset-y-0 left-0 w-[42%] bg-stone-900" />
        <div className="absolute inset-y-0 left-0 w-[42%] flex flex-col justify-center px-2">
          <p className="font-mono text-[6px] text-white/40 uppercase tracking-widest">Cover</p>
          <p className="text-[8px] font-bold text-white leading-tight mt-0.5 truncate">
            {project.name.toUpperCase()}
          </p>
        </div>
        <div className="absolute inset-y-0 right-0 w-[58%] bg-stone-100 flex flex-col justify-center px-2">
          <p className="font-mono text-[6px] text-stone-400 uppercase">For {project.clientName}</p>
        </div>
      </div>
    );
  }

  if (slide.type === "site") {
    return (
      <div className="w-full h-full bg-[#f7f5f2] flex flex-col p-2">
        <p className="font-mono text-[6px] text-stone-400 uppercase tracking-widest mb-1">Site Context</p>
        <div className="space-y-0.5 flex-1">
          {[
            project.plotInfo?.propertyType,
            project.plotInfo?.numberOfBedrooms ? `${project.plotInfo.numberOfBedrooms} BHK` : null,
            project.plotInfo?.facing,
          ].filter(Boolean).slice(0, 3).map((v, i) => (
            <div key={i} className={`flex text-[5px] py-0.5 px-1 ${i % 2 === 0 ? "bg-stone-200/60" : ""}`}>
              <span className="text-stone-500 flex-1 truncate">{v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slide.type === "plan") {
    return (
      <div className="w-full h-full bg-stone-900 relative">
        <img src={project.planImageUrl} alt="plan"
          className="absolute inset-0 w-full h-full object-contain p-2 opacity-80" />
        <div className="absolute top-1 left-1">
          <span className="font-mono text-[5px] text-stone-400 uppercase">Floor Plan</span>
        </div>
      </div>
    );
  }

  if (slide.type === "strengths") {
    return (
      <div className="w-full h-full bg-[#f7f5f2] p-2">
        <p className="font-mono text-[5px] text-stone-400 uppercase tracking-widest mb-1.5">Plan Strengths</p>
        <div className="grid grid-cols-2 gap-1 h-[calc(100%-16px)]">
          {planStrengths.slice(0, 4).map((s, i) => (
            <div key={i} className="flex gap-0.5">
              <span className="font-mono text-[5px] text-stone-300">{String(i+1).padStart(2,"0")}</span>
              <p className="text-[5px] text-stone-600 leading-tight line-clamp-3">{s}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slide.type === "moodboard" && slide.imageUrl) {
    return (
      <div className="w-full h-full relative">
        <img src={slide.imageUrl} alt={slide.roomName}
          className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute bottom-1 left-1.5">
          <p className="font-mono text-[5px] text-white uppercase tracking-widest">{slide.roomName}</p>
        </div>
      </div>
    );
  }

  return <div className={`${base} bg-stone-100`}><span className="text-lg">{slide.icon}</span></div>;
}

// ─── Large slide preview ──────────────────────────────────────────────────────

function SlidePreviewLarge({ slide, project }: { slide: SlidePreview; project: Project }) {
  if (!slide) return null;
  const { planStrengths = [] } = project;

  if (slide.type === "cover") {
    return (
      <div className="w-full h-full flex">
        {/* Left accent panel */}
        <div className="w-[42%] bg-stone-900 flex flex-col justify-between p-8 relative">
          <div>
            <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest">
              Concept Presentation
            </p>
          </div>
          <div>
            <div className="w-16 h-0.5 bg-white/20 mb-4" />
            <h2 className="text-2xl font-bold text-white leading-tight mb-3 uppercase tracking-wide">
              {project.name}
            </h2>
            <p className="text-sm text-white/50 italic">Prepared for</p>
            <p className="text-base text-white/80 mt-0.5">{project.clientName}</p>
          </div>
          <div>
            {project.plotInfo && (
              <p className="font-mono text-[9px] text-white/30 uppercase tracking-widest">
                {[project.plotInfo.numberOfBedrooms && `${project.plotInfo.numberOfBedrooms} BHK`,
                  project.plotInfo.propertyType,
                  project.plotInfo.facing && `${project.plotInfo.facing}-facing`,
                ].filter(Boolean).join("  ·  ")}
              </p>
            )}
          </div>
        </div>
        {/* Right light panel */}
        <div className="flex-1 bg-stone-50 flex flex-col justify-between p-8">
          <div className="flex justify-end">
            <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">
              {project.firmName}
            </p>
          </div>
          <div>
            <p className="text-stone-400 text-sm italic">
              {new Date(project.createdAt).toLocaleDateString("en-GB", {
                day: "numeric", month: "long", year: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (slide.type === "site") {
    const p = project.plotInfo!;
    const rows = [
      { label: "Property Type",      value: p.propertyType },
      { label: "Configuration",      value: p.numberOfBedrooms ? `${p.numberOfBedrooms} BHK` : null },
      { label: "Built-up Area",      value: p.builtUpAreaSqm ? `${p.builtUpAreaSqm} sqm` : null },
      { label: "Plot / Carpet Area", value: p.plotAreaSqm ? `${p.plotAreaSqm} sqm` : null },
      { label: "Plot Facing",        value: p.facing },
      { label: "Floor Location",     value: p.floorLocation ? `${p.floorLocation} floor` : null },
      { label: "Vaastu",             value: p.vaastuCompliance ? "Required" : null },
    ].filter((r) => r.value);

    return (
      <div className="w-full h-full bg-stone-50 flex p-8 gap-8">
        <div className="flex-1 space-y-0">
          <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-4">Site Context</p>
          {rows.map((row, i) => (
            <div key={i} className={`flex items-center py-2 px-2 ${i % 2 === 0 ? "bg-stone-100" : ""}`}>
              <span className="font-mono text-[9px] uppercase tracking-wider text-stone-400 w-36 flex-shrink-0">
                {row.label}
              </span>
              <span className="text-sm text-stone-800">{row.value}</span>
            </div>
          ))}
          {p.additionalNotes && (
            <div className="mt-4 pt-3 border-t border-stone-200">
              <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-1">Notes</p>
              <p className="text-xs text-stone-600 leading-relaxed">{p.additionalNotes}</p>
            </div>
          )}
        </div>
        {/* Compass */}
        {p.facing && (
          <div className="w-40 flex flex-col items-center justify-center">
            <CompassPreview facing={p.facing} />
            <p className="font-mono text-[9px] text-stone-400 mt-3 uppercase tracking-widest">
              {p.facing} facing
            </p>
          </div>
        )}
      </div>
    );
  }

  if (slide.type === "plan") {
    return (
      <div className="w-full h-full bg-stone-900 flex">
        <div className="flex-1 flex items-center justify-center p-6">
          <img src={project.planImageUrl} alt="floor plan"
            className="max-w-full max-h-full object-contain" />
        </div>
        <div className="w-44 bg-stone-950 flex flex-col justify-between p-5">
          <div>
            <p className="font-mono text-[9px] text-stone-500 uppercase tracking-widest mb-4">Rooms</p>
            <div className="space-y-2">
              {(project.analysis?.rooms ?? []).slice(0, 8).map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-stone-400 truncate">{r.name}</span>
                  {r.sizeEstimateSqm && (
                    <span className="font-mono text-[9px] text-stone-600 flex-shrink-0">
                      {r.sizeEstimateSqm}m²
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {project.analysis?.totalAreaSqm && (
            <p className="font-mono text-[10px] text-stone-400">
              Total  ·  {project.analysis.totalAreaSqm} m²
            </p>
          )}
        </div>
      </div>
    );
  }

  if (slide.type === "strengths") {
    const col1 = planStrengths.slice(0, Math.ceil(planStrengths.length / 2));
    const col2 = planStrengths.slice(Math.ceil(planStrengths.length / 2));
    return (
      <div className="w-full h-full bg-stone-50 p-8">
        <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-1">Plan Strengths</p>
        <p className="text-sm text-stone-500 italic mb-5">
          What makes {project.name} work for you
        </p>
        <div className="grid grid-cols-2 gap-x-10 gap-y-0">
          {[col1, col2].map((col, ci) => (
            <div key={ci} className="space-y-0">
              {col.map((s, i) => (
                <div key={i} className="flex gap-3 py-2.5 border-b border-stone-200 last:border-0">
                  <span className="font-mono text-[10px] text-stone-200 flex-shrink-0 pt-0.5">
                    {String(ci === 0 ? i + 1 : col1.length + i + 1).padStart(2, "0")}
                  </span>
                  <p className="text-[11px] text-stone-700 leading-relaxed">{s}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slide.type === "moodboard" && slide.imageUrl) {
    return (
      <div className="w-full h-full relative">
        <img src={slide.imageUrl} alt={slide.roomName}
          className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-stone-700" />
        <div className="absolute bottom-6 left-8">
          <div className="w-12 h-0.5 bg-stone-500 mb-3" />
          <p className="text-2xl font-bold text-white uppercase tracking-wide">{slide.roomName}</p>
          <p className="text-xs text-white/40 mt-1 font-mono uppercase tracking-widest">
            Interior Concept
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-stone-100 flex items-center justify-center">
      <p className="text-stone-400 font-mono text-xs uppercase tracking-widest">{slide.label}</p>
    </div>
  );
}

// ─── Slide detail panel ───────────────────────────────────────────────────────

function SlideDetailPanel({
  slide, project, slideIndex,
}: {
  slide: SlidePreview;
  project: Project;
  slideIndex: number;
}) {
  const editLinks: Record<string, string> = {
    cover:     `/project/${project.id}/review`,
    site:      `/project/${project.id}/new`,
    plan:      `/project/${project.id}/review`,
    strengths: `/project/${project.id}/review`,
    moodboard: `/project/${project.id}/moodboards`,
  };

  const descriptions: Record<string, string> = {
    cover:     `Cover slide with project name, client, and firm details.`,
    site:      `Site context — plot details, facing direction, and configuration.`,
    plan:      `Floor plan with ${project.analysis?.rooms?.length ?? "?"} detected rooms listed on the right.`,
    strengths: `${project.planStrengths?.length ?? 0} client-friendly bullets about this plan's key advantages.`,
    moodboard: `Interior moodboard for ${slide.roomName} — full-bleed image with room label overlay.`,
  };

  return (
    <div className="card p-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="w-8 h-8 border border-stone-200 rounded-sm flex items-center justify-center flex-shrink-0">
          <span className="font-mono text-[10px] text-stone-400">{String(slideIndex + 1).padStart(2, "0")}</span>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-stone-600">{slide.label}</p>
          <p className="text-xs text-stone-400 mt-0.5">{descriptions[slide.type]}</p>
        </div>
      </div>
      <a href={editLinks[slide.type]} className="btn-ghost text-[10px]">Edit →</a>
    </div>
  );
}

// ─── Compass preview ──────────────────────────────────────────────────────────

function CompassPreview({ facing }: { facing: string }) {
  const size = 60;
  const cx   = size / 2;
  const cy   = size / 2;
  const r    = size / 2 - 6;

  const angles: Record<string, number> = {
    North: 90, South: 270, East: 0, West: 180,
    "North-East": 45, "North-West": 135, "South-East": 315, "South-West": 225,
  };
  const rad = ((angles[facing] ?? 90) * Math.PI) / 180;
  const ex  = cx + Math.cos(rad) * (r - 4);
  const ey  = cy - Math.sin(rad) * (r - 4);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2ddd8" strokeWidth="1" />
      {["N","S","E","W"].map((label) => {
        const a = { N: 90, S: 270, E: 0, W: 180 }[label]! * Math.PI / 180;
        const lx = cx + Math.cos(a) * (r + 3);
        const ly = cy - Math.sin(a) * (r + 3);
        return (
          <text key={label} x={lx} y={ly + 3} textAnchor="middle"
            fontSize="7" fontFamily="monospace" fill={facing.startsWith(label) ? "#2d2b27" : "#c8c2b8"}>
            {label}
          </text>
        );
      })}
      <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="#2d2b27" strokeWidth="2" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="2.5" fill="#2d2b27" />
    </svg>
  );
}

// ─── Icons & utility ──────────────────────────────────────────────────────────

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function PageSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-8">
      <div className="skeleton h-6 w-64" />
      <div className="skeleton h-8 w-48" />
      <div className="grid grid-cols-4 gap-6">
        <div className="skeleton h-96" />
        <div className="col-span-3 skeleton h-96" />
      </div>
    </div>
  );
}
