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

  // Share link state
  const [shareUrl,     setShareUrl]     = useState<string | null>(null);
  const [shareExpiry,  setShareExpiry]  = useState("never");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied,  setShareCopied]  = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareViews,   setShareViews]   = useState(0);

  const STEPS = [
    { num: "1", label: "Upload",     status: "complete" as const },
    { num: "2", label: "Review",     status: "complete" as const },
    { num: "3", label: "Moodboards", status: "complete" as const },
    { num: "4", label: "Export",     status: "active"   as const },
  ];

  function loadProject() {
    // cache: "no-store" forces a fresh fetch every time — prevents the
    // browser / Next.js fetch cache from serving stale project data after
    // edits made on the Moodboards or Review pages.
    fetch(`/api/projects/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setProject(d.project);
        if (d.project.shareToken && d.project.shareEnabled !== false) {
          setShareUrl(`${window.location.origin}/share/${d.project.shareToken}`);
          setShareEnabled(true);
        }
        setShareViews(d.project.shareViewCount ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    loadProject();
    // Re-fetch whenever the tab/window regains focus — covers the common
    // case of editing moodboards in another tab, or coming back via
    // browser back/forward (bfcache) where this effect wouldn't re-run.
    function onFocus() { loadProject(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Share link functions ────────────────────────────────────────────────
  async function generateShareLink() {
    setShareLoading(true);
    try {
      const res  = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, expiresIn: shareExpiry }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setShareUrl(data.shareUrl);
      setShareEnabled(true);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to generate link");
    } finally {
      setShareLoading(false);
    }
  }

  async function disableShareLink() {
    setShareLoading(true);
    try {
      await fetch("/api/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
      });
      setShareEnabled(false);
    } catch { setExportError("Failed to disable link"); }
    finally { setShareLoading(false); }
  }

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    });
  }

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

  const { analysis, planStrengths = [], moodboards = [], styleProfile,
          overallMoodboard, roomMoodboards = [] } = project;
  const isReady = planStrengths.length > 0;

  // Build slide deck — mirrors PDF page order
  const slides: SlidePreview[] = [
    { type: "cover",     label: "Cover",        icon: "⬛" },
    ...(project.plotInfo && Object.keys(project.plotInfo).length > 0
      ? [{ type: "site" as const, label: "Site Context", icon: "🧭" }]
      : []),
    { type: "plan",      label: "Floor Plan",   icon: "📐", imageUrl: project.planImageUrl },
    ...(planStrengths.length > 0
      ? [{ type: "strengths" as const, label: "Plan Strengths", icon: "✦" }]
      : []),
    // Overall style moodboard slide
    ...(overallMoodboard
      ? [{ type: "overall-mood" as const, label: "Overall Style", icon: "🎨",
           imageUrl: overallMoodboard.images[0]?.url }]
      : []),
    // Per-room slides (use roomMoodboards if available, else legacy moodboards)
    ...(roomMoodboards.length > 0
      ? roomMoodboards.map((rm) => ({
          type: "room-mood" as const,
          label: rm.roomName,
          icon: "🖼",
          imageUrl: rm.images[0]?.url,
          roomName: rm.roomName,
          planSnippetUrl: rm.planSnippetUrl,
          images: rm.images,
        }))
      : moodboards.map((mb) => ({
          type: "moodboard" as const,
          label: mb.roomName,
          icon: "🖼",
          imageUrl: mb.imageUrl,
          roomName: mb.roomName,
        }))
    ),
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
          { label: "Rooms Styled",   value: String(roomMoodboards.length > 0 ? roomMoodboards.length : moodboards.length) },
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

      {/* ── Share link panel ─────────────────────────────────────────────── */}
      <div className="mt-6 card overflow-hidden fade-up fade-up-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${shareEnabled && shareUrl ? "bg-green-400" : "bg-stone-300"}`} />
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-stone-700">Client Presentation Link</p>
              <p className="text-xs text-stone-400 mt-0.5">Live browser presentation — no PDF download needed</p>
            </div>
          </div>
          {shareViews > 0 && (
            <span className="font-mono text-[10px] text-stone-400 bg-stone-100 px-2 py-1 rounded-sm">
              {shareViews} {shareViews === 1 ? "view" : "views"}
            </span>
          )}
        </div>

        <div className="px-6 py-5 space-y-4">
          {!shareUrl ? (
            /* Not yet generated */
            <div className="flex items-end gap-4 flex-wrap">
              <div className="space-y-1">
                <label className="field-label">Link expiry</label>
                <select className="field-input w-44" value={shareExpiry} onChange={(e) => setShareExpiry(e.target.value)}>
                  <option value="never">Never expires</option>
                  <option value="30d">30 days</option>
                  <option value="7d">7 days</option>
                </select>
              </div>
              <button onClick={generateShareLink} disabled={shareLoading || !isReady} className="btn-primary">
                {shareLoading
                  ? <><span className="spinner" /><span>Generating…</span></>
                  : <><LinkIcon /><span>Generate Share Link</span></>}
              </button>
              {!isReady && <p className="text-xs text-stone-400 self-end pb-2">Complete plan analysis first.</p>}
            </div>
          ) : (
            /* Link generated */
            <div className="space-y-3">
              {/* URL bar + action buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className={`flex-1 flex items-center gap-2 border rounded-sm px-3 py-2.5 min-w-0 ${shareEnabled ? "border-stone-200 bg-stone-50" : "border-stone-100 bg-stone-50 opacity-50"}`}>
                  <LinkIcon className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                  <span className="font-mono text-xs text-stone-600 truncate">{shareUrl}</span>
                </div>
                <button onClick={copyLink} disabled={!shareEnabled} className="btn-secondary flex-shrink-0">
                  {shareCopied ? <><CheckIcon /><span>Copied!</span></> : <><CopyIcon /><span>Copy</span></>}
                </button>
                <a href={shareEnabled ? shareUrl : "#"} target="_blank" rel="noreferrer"
                  className={`btn-secondary flex-shrink-0 ${!shareEnabled ? "pointer-events-none opacity-40" : ""}`}>
                  <ExternalIcon /><span>Preview</span>
                </a>
              </div>

              {/* Toggle + expiry */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <button type="button"
                      onClick={shareEnabled ? disableShareLink : generateShareLink}
                      disabled={shareLoading}
                      className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${shareEnabled ? "bg-stone-800" : "bg-stone-200"}`}
                      role="switch" aria-checked={shareEnabled}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${shareEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                    <span className="text-xs text-stone-500">{shareEnabled ? "Active" : "Disabled"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-400">Expiry:</span>
                    <select className="font-mono text-[10px] text-stone-500 bg-transparent border border-stone-200 rounded-sm px-2 py-1"
                      value={shareExpiry} onChange={(e) => setShareExpiry(e.target.value)}>
                      <option value="never">Never</option>
                      <option value="30d">30 days</option>
                      <option value="7d">7 days</option>
                    </select>
                  </div>
                </div>
                <button onClick={generateShareLink} disabled={shareLoading} className="btn-ghost text-[10px]">
                  {shareLoading ? "Updating…" : "↻ Refresh link"}
                </button>
              </div>

              {/* Hint */}
              <div className="bg-stone-50 border border-stone-100 rounded-sm px-4 py-3">
                <p className="text-xs text-stone-500 leading-relaxed">
                  <strong className="text-stone-700">Send this link to your client.</strong>{" "}
                  Opens in any browser — no app or login needed. Full 16:9 presentation with keyboard and click navigation.
                </p>
              </div>
            </div>
          )}
        </div>
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
  type: "cover" | "site" | "plan" | "strengths" | "moodboard" | "overall-mood" | "room-mood";
  label: string;
  icon: string;
  imageUrl?: string;
  roomName?: string;
  planSnippetUrl?: string;
  images?: Array<{ url: string; caption?: string }>;
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

  // Overall style moodboard thumbnail — 2×2 grid
  if (slide.type === "overall-mood" && slide.imageUrl) {
    const imgs = [slide.imageUrl, ...(slide.images?.slice(1, 4).map(i => i.url) ?? [])];
    return (
      <div className="w-full h-full bg-stone-900 grid grid-cols-2 gap-0.5 p-0.5">
        {imgs.slice(0, 4).map((url, i) => (
          <div key={i} className="relative overflow-hidden">
            <img src={url} alt="" className="w-full h-full object-cover" />
          </div>
        ))}
        <div className="absolute bottom-1 left-1.5">
          <p className="font-mono text-[5px] text-white uppercase tracking-widest">Overall Style</p>
        </div>
      </div>
    );
  }

  // Per-room moodboard thumbnail — plan snippet + image grid
  if (slide.type === "room-mood") {
    return (
      <div className="w-full h-full bg-[#f7f5f2] flex gap-0.5 p-0.5">
        {/* Plan snippet */}
        <div className="w-[28%] bg-white flex items-center justify-center overflow-hidden">
          <img src={slide.planSnippetUrl ?? project.planImageUrl} alt="plan"
            className="w-full h-full object-contain" style={{imageRendering:"crisp-edges"}} />
        </div>
        {/* Mood images */}
        <div className="flex-1 grid grid-cols-3 gap-0.5">
          {(slide.images ?? []).slice(0, 3).map((img, i) => (
            <div key={i} className="relative overflow-hidden">
              <img src={img.url} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
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

  // Overall style moodboard — 2×2 collage
  if (slide.type === "overall-mood") {
    const imgs = slide.images ?? [];
    return (
      <div className="w-full h-full bg-stone-900 flex flex-col">
        {/* Title bar */}
        <div className="flex items-center justify-between px-6 py-3 flex-shrink-0">
          <div>
            <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">Interior Style · Overall Concept</p>
            <p className="text-base font-bold text-white mt-0.5 uppercase tracking-wide">
              {slide.label}
            </p>
          </div>
          {project.styleProfile && (
            <div className="flex gap-1.5">
              {[project.styleProfile.overallStyle, project.styleProfile.budgetVibe].map((t) => (
                <span key={t} className="font-mono text-[8px] uppercase tracking-wider text-stone-400 border border-stone-700 px-2 py-0.5">{t}</span>
              ))}
            </div>
          )}
        </div>
        {/* 2×2 image grid */}
        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-1 p-1">
          {imgs.slice(0, 4).map((img, i) => (
            <div key={i} className="relative overflow-hidden group">
              <img src={img.url} alt={img.caption}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="absolute bottom-2 left-3 font-mono text-[9px] text-white uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                {img.caption}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Per-room moodboard — plan snippet + image grid
  if (slide.type === "room-mood") {
    const rm = project.roomMoodboards?.find((r) => r.roomName === slide.roomName);
    const roomDetail = project.analysis?.rooms.find((r) => r.name === slide.roomName);
    return (
      <div className="w-full h-full bg-stone-50 flex">
        {/* Left: plan snippet + room info */}
        <div className="w-[26%] bg-white border-r border-stone-200 flex flex-col p-5 gap-3">
          <div>
            <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest mb-1">{slide.roomName}</p>
            {roomDetail?.sizeEstimateSqm && (
              <p className="text-2xl font-light text-stone-800">{roomDetail.sizeEstimateSqm}<span className="text-sm text-stone-400 ml-1">m²</span></p>
            )}
            {roomDetail?.orientation && (
              <p className="font-mono text-[9px] text-stone-400 mt-1">{roomDetail.orientation}</p>
            )}
          </div>
          {/* Plan snippet */}
          <div className="flex-1 flex flex-col items-center justify-center bg-stone-50 rounded-sm overflow-hidden">
            <img src={slide.planSnippetUrl ?? project.planImageUrl} alt={slide.planSnippetUrl ? "plan snippet" : "full plan"}
              className="max-w-full max-h-full object-contain"
              style={{ imageRendering: "crisp-edges" }} />
            {!slide.planSnippetUrl && (
              <p className="font-mono text-[8px] text-stone-300 uppercase mt-1">Full plan</p>
            )}
          </div>
          {/* Special features */}
          {roomDetail?.specialFeatures && roomDetail.specialFeatures.length > 0 && (
            <div className="space-y-1">
              {roomDetail.specialFeatures.slice(0, 3).map((f) => (
                <p key={f} className="font-mono text-[9px] text-stone-400">· {f}</p>
              ))}
            </div>
          )}
        </div>

        {/* Right: mood images */}
        <div className="flex-1 flex flex-col gap-1 p-1">
          {/* Top 3 images */}
          <div className="flex-1 grid grid-cols-3 gap-1">
            {(rm?.images ?? slide.images ?? []).slice(0, 3).map((img, i) => (
              <div key={i} className="relative overflow-hidden group">
                <img src={img.url} alt={img.caption}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="absolute bottom-2 left-2 font-mono text-[9px] text-white uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                  {img.caption}
                </span>
              </div>
            ))}
          </div>
          {/* 4th image wide strip */}
          {((rm?.images ?? slide.images ?? [])[3]) && (
            <div className="h-20 relative overflow-hidden group flex-shrink-0">
              <img src={(rm?.images ?? slide.images ?? [])[3].url} alt=""
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[9px] text-white uppercase tracking-widest">
                {(rm?.images ?? slide.images ?? [])[3].caption}
              </span>
            </div>
          )}
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
    cover:        `/project/${project.id}/review`,
    site:         `/project/${project.id}/new`,
    plan:         `/project/${project.id}/review`,
    strengths:    `/project/${project.id}/review`,
    moodboard:    `/project/${project.id}/moodboards`,
    "overall-mood": `/project/${project.id}/moodboards`,
    "room-mood":  `/project/${project.id}/moodboards`,
  };

  const rmDetail = project.roomMoodboards?.find((r) => r.roomName === slide.roomName);
  const descriptions: Record<string, string> = {
    cover:        `Cover slide — project name, client, and firm details.`,
    site:         `Site context — plot details, facing direction, and configuration.`,
    plan:         `Floor plan with ${project.analysis?.rooms?.length ?? "?"} detected rooms listed on the right.`,
    strengths:    `${project.planStrengths?.length ?? 0} client-friendly bullets about this plan's key advantages.`,
    moodboard:    `Interior moodboard for ${slide.roomName}.`,
    "overall-mood": `Overall interior style collage — 4 images showing the full design language of the home.`,
    "room-mood":  `${slide.roomName}: plan snippet + ${rmDetail?.images?.length ?? 3} mood images. ${project.analysis?.rooms?.find(r => r.name === slide.roomName)?.sizeEstimateSqm ? project.analysis?.rooms?.find(r => r.name === slide.roomName)?.sizeEstimateSqm + " sqm." : ""}`,
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

function LinkIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
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
