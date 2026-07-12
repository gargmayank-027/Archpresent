"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { StepIndicator } from "@/components/StepIndicator";
import { FloodFillRenderer } from "@/components/FloodFillRenderer";
import type { Project, PlanAnalysis, PlotInfo } from "@/types";

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();

  const [project,   setProject]   = useState<Project | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [analysing,    setAnalysing]    = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>("");
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [analysis,  setAnalysis]  = useState<PlanAnalysis | null>(null);
  const [enhNotes,  setEnhNotes]  = useState<string[]>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showRendered, setShowRendered] = useState(false);
  const [showAiRender, setShowAiRender] = useState(false);
  const [aiRendering, setAiRendering]   = useState(false);
  const [aiRenderError, setAiRenderError] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState<string>("graphite");

  // Fetch firm accent color for the plan renderer palette
  useEffect(() => {
    fetch("/api/firm").then(r => r.json()).then(d => {
      if (d.firm?.accentColor) setAccentColor(d.firm.accentColor);
    }).catch(() => {});
  }, []);

  async function triggerAiRender() {
    if (!project) return;
    setAiRendering(true);
    setAiRenderError(null);
    try {
      const res = await fetch("/api/ai-render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI rendering failed");
      setProject(p => p ? { ...p, aiRenderedPlanUrl: data.aiRenderedPlanUrl } : p);
      setShowAiRender(true);
      setShowRendered(false);
      setShowOriginal(false);
    } catch (err) {
      setAiRenderError(err instanceof Error ? err.message : "AI rendering failed");
    } finally {
      setAiRendering(false);
    }
  }
  const [strengths, setStrengths] = useState<string[]>([]);
  const [selectingFloor, setSelectingFloor] = useState(false);
  const [floorError,     setFloorError]     = useState<string | null>(null);

  const isConcept = project?.presentationType === "concept";

  const STEPS = isConcept
    ? [
        { num: "1", label: "Upload",  status: "complete" as const },
        { num: "2", label: "Review",  status: "active"   as const },
        { num: "3", label: "Export",  status: "pending"  as const },
      ]
    : [
        { num: "1", label: "Upload",     status: "complete" as const },
        { num: "2", label: "Review",     status: "active"   as const },
        { num: "3", label: "Moodboards", status: "pending"  as const },
        { num: "4", label: "Export",     status: "pending"  as const },
      ];

  const [autoRasterizing, setAutoRasterizing] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setProject(d.project);
        if (d.project.analysis)      setAnalysis(d.project.analysis);
        if (d.project.planStrengths) setStrengths(d.project.planStrengths);
        setLoading(false);

        // Auto-rasterize: if the plan image is a PDF (single-page upload
        // that skipped the floor picker), render it to PNG client-side
        // and upload it so the <img> tag and AI analysis can use it.
        const planUrl = (d.project.planImageUrl ?? "").split("?")[0].toLowerCase();
        if (planUrl.endsWith(".pdf")) {
          autoRasterizePdf(d.project);
        }
      })
      .catch(() => setLoading(false));
  }, [id]);

  async function autoRasterizePdf(proj: Project) {
    setAutoRasterizing(true);
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      const pdfRes = await fetch(proj.planImageUrl);
      const pdfData = new Uint8Array(await pdfRes.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const page = await doc.getPage(1);

      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error("Canvas to blob failed")),
          "image/png"
        );
      });

      const fd = new FormData();
      fd.append("selectedPageIndex", "0");
      fd.append("planImage", blob, "plan.png");

      const res = await fetch(`/api/projects/${proj.id}/select-floor`, { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.project) {
        setProject(data.project);
      }
      doc.destroy();
    } catch (err) {
      console.error("Auto-rasterize failed:", err);
    } finally {
      setAutoRasterizing(false);
    }
  }

  async function selectFloor(pageIndex: number) {
    setSelectingFloor(true);
    setFloorError(null);
    try {
      const page = project!.planPages![pageIndex];

      // 1. Render the PDF page to a canvas using pdfjs-dist in the browser
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      const pdfRes = await fetch(page.imageUrl);
      const pdfData = new Uint8Array(await pdfRes.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const pdfPage = await doc.getPage(1); // single-page PDF, always page 1

      // Render at 3x scale for crisp AI analysis (small labels must stay legible)
      const viewport = pdfPage.getViewport({ scale: 3 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;

      // 2. Convert canvas to PNG blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error("Canvas to blob failed")),
          "image/png"
        );
      });

      // 3. Upload the PNG to the server
      const fd = new FormData();
      fd.append("selectedPageIndex", String(pageIndex));
      fd.append("planImage", blob, `floor-${pageIndex + 1}.png`);

      const res = await fetch(`/api/projects/${id}/select-floor`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not select this floor");

      setProject(data.project);
      setAnalysis(null);
      setStrengths([]);

      doc.destroy();
    } catch (err) {
      console.error("Floor selection failed:", err);
      setFloorError(err instanceof Error ? err.message : "Could not select this floor");
    } finally {
      setSelectingFloor(false);
    }
  }

  async function runAnalysis() {
    if (!project) return;

    // Guard: if planImageUrl is still a PDF, rasterize it first.
    // This handles the case where auto-rasterize didn't run (e.g. older
    // project created before this feature, or race condition on first load).
    if (project.planImageUrl?.toLowerCase().endsWith(".pdf")) {
      setAnalysing(true);
      setAnalysisStep("Converting plan to image…");
      try {
        await autoRasterizePdf(project);
        // Re-fetch project to get the updated PNG URL
        const projRes = await fetch(`/api/projects/${id}`, { cache: "no-store" });
        const projData = await projRes.json();
        if (projData.project) {
          setProject(projData.project);
          // Check if it's still a PDF (rasterization failed)
          if (projData.project.planImageUrl?.toLowerCase().endsWith(".pdf")) {
            throw new Error("Could not convert PDF plan to image. Please re-upload as PNG or JPEG.");
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to process plan");
        setAnalysing(false);
        return;
      }
    }

    setAnalysing(true);
    setError(null);
    setAnalysisStep("Enhancing plan image…");

    // Progress message ticker
    const steps = [
      { delay: 2000,  msg: "Enhancing plan image…" },
      { delay: 5000,  msg: "Reading floor plan…" },
      { delay: 10000, msg: "Identifying rooms…" },
      { delay: 18000, msg: "Drafting plan strengths…" },
      { delay: 28000, msg: "Almost done…" },
    ];
    const timers = steps.map(({ delay, msg }) => setTimeout(() => setAnalysisStep(msg), delay));

    try {
      // 90-second timeout — Sharp + Gemini can take up to ~30s on first run
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      const res  = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      setAnalysis(data.analysis);
      setStrengths(data.strengths);
      if (data.enhancement) setEnhNotes(data.enhancement);
      // Re-fetch the full project to get renderedPlanUrl and any other updates
      try {
        const projRes = await fetch(`/api/projects/${id}`);
        const projData = await projRes.json();
        if (projData.project) {
          setProject(projData.project);
          // Auto-show the rendered plan if it was generated
          if (projData.project.renderedPlanUrl) setShowRendered(true);
        }
      } catch {
        setProject((p) => p ? { ...p, status: "analyzed", planImageUrl: data.enhancedUrl ?? p.planImageUrl } : p);
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const msg = isTimeout
        ? "Request timed out after 90 seconds. Check your terminal for errors and try again."
        : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      timers.forEach(clearTimeout);
      setAnalysisStep("");
      setAnalysing(false);
    }
  }

  async function saveAndContinue() {
    setSaving(true);
    try {
      await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, strengths, analysis }),
      });
      router.push(isConcept ? `/project/${id}/export` : `/project/${id}/moodboards`);
    } catch {
      setError("Save failed — please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || autoRasterizing) return <PageSkeleton />;
  if (!project) return <div className="p-12 text-center text-stone-400">Project not found.</div>;

  // Multi-floor PDF upload — ask which floor to proceed with before showing
  // anything else. Everything downstream (analysis, moodboards, export)
  // works on a single active plan, so this choice has to happen first.
  const needsFloorSelection =
    !!project.planPages && project.planPages.length > 1 && !project.floorSelectionConfirmed;

  if (needsFloorSelection) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-10 fade-up fade-up-1">
          <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
            <StepIndicator steps={STEPS} />
            <p className="font-mono text-xs text-stone-400 uppercase tracking-widest">{project.clientName}</p>
          </div>
          <h1 className="font-display text-4xl font-light text-stone-900 mb-2"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            Which floor should we move forward with?
          </h1>
          <p className="text-stone-500 text-sm">
            This PDF has {project.planPages!.length} pages — pick the floor plan you'd like to build this presentation from.
            You can start a new project for any other floors later.
          </p>
        </div>

        {floorError && (
          <div className="mb-6 border border-red-200 bg-red-50 rounded-sm px-4 py-3 text-sm text-red-600">
            {floorError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 fade-up fade-up-2">
          {project.planPages!.map((page, i) => (
            <button key={page.pageNumber} type="button"
              disabled={selectingFloor}
              onClick={() => selectFloor(i)}
              className="card p-3 bg-white text-left group hover:ring-1 hover:ring-stone-900 transition-all disabled:opacity-50">
              <div className="aspect-[4/3] bg-stone-50 rounded-sm overflow-hidden mb-3 flex items-center justify-center">
                <PdfPageThumb pdfUrl={page.imageUrl} />
              </div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs uppercase tracking-widest text-stone-700">
                  {page.label ?? `Floor ${page.pageNumber}`}
                </p>
                <span className="font-mono text-[10px] text-stone-300">
                  Page {page.pageNumber} / {project.planPages!.length}
                </span>
              </div>
              <p className="font-mono text-[10px] text-stone-400 mt-1 group-hover:text-stone-600">
                {selectingFloor ? "Selecting…" : "Use this floor →"}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10 fade-up fade-up-1">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <StepIndicator steps={STEPS} />
          <p className="font-mono text-xs text-stone-400 uppercase tracking-widest">{project.clientName}</p>
        </div>
        <h1 className="font-display text-4xl font-light text-stone-900 mb-2"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          {project.name}
        </h1>
        <p className="text-stone-500 text-sm">
          Review the site context, then run AI analysis to extract rooms and draft plan strengths.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

        {/* ── Left col: plan image + site context ─────────────────────── */}
        <div className="lg:col-span-3 space-y-5 fade-up fade-up-2">

          {/* Plan image — with Original / Enhanced / Rendered / AI Render toggle */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Floor Plan</p>
              <div className="flex items-center gap-0 border border-stone-200 rounded-sm overflow-hidden">
                {(project.aiRenderedPlanUrl || (analysis?.rooms?.length && process.env.NEXT_PUBLIC_HAS_REPLICATE)) && (
                  <button type="button"
                    onClick={() => {
                      if (project.aiRenderedPlanUrl) {
                        setShowAiRender(true); setShowRendered(false); setShowOriginal(false);
                      } else {
                        triggerAiRender();
                      }
                    }}
                    disabled={aiRendering}
                    className={`px-3 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors ${
                      showAiRender ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-700"
                    }`}>
                    {aiRendering ? "Generating…" : "AI Render"}
                  </button>
                )}
                {analysis?.rooms?.some(r => r.boundingBox) && (
                  <button type="button"
                    onClick={() => { setShowAiRender(false); setShowOriginal(false); setShowRendered(true); }}
                    className={`px-3 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors ${
                      showRendered ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-700"
                    }`}>
                    Color-coded
                  </button>
                )}
                <button type="button"
                  onClick={() => { setShowAiRender(false); setShowOriginal(false); setShowRendered(false); }}
                  className={`px-3 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors ${
                    !showOriginal && !showRendered && !showAiRender ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-700"
                  }`}>
                  {project.originalPlanImageUrl && project.originalPlanImageUrl !== project.planImageUrl ? "Enhanced" : "Plan"}
                </button>
                {project.originalPlanImageUrl && project.originalPlanImageUrl !== project.planImageUrl && (
                  <button type="button"
                    onClick={() => { setShowAiRender(false); setShowOriginal(true); setShowRendered(false); }}
                    className={`px-3 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors ${
                      showOriginal ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-700"
                    }`}>
                    Original
                  </button>
                )}
              </div>
            </div>

            <div className="card p-4 bg-white relative overflow-hidden">
              {showAiRender && project.aiRenderedPlanUrl ? (
                <img
                  src={project.aiRenderedPlanUrl}
                  alt="AI-rendered floor plan"
                  className="w-full object-contain max-h-[480px] rounded-sm"
                />
              ) : showAiRender && aiRendering ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <span className="spinner w-6 h-6 text-stone-400" />
                  <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">Generating AI render…</p>
                  <p className="text-[11px] text-stone-400">This takes 15–30 seconds</p>
                </div>
              ) : showRendered && analysis?.rooms ? (
                <FloodFillRenderer
                  planImageUrl={project.planImageUrl}
                  rooms={analysis.rooms}
                  plotInfo={project.plotInfo}
                  accentColor={accentColor}
                  height={480}
                  onRendered={async (blob) => {
                    try {
                      const fd = new FormData();
                      fd.append("projectId", project.id);
                      fd.append("renderedPlan", blob, "rendered.png");
                      const res = await fetch("/api/render-plan/upload", { method: "POST", body: fd });
                      if (res.ok) {
                        const data = await res.json();
                        setProject((p) => p ? { ...p, renderedPlanUrl: data.renderedPlanUrl } : p);
                      }
                    } catch { /* non-fatal */ }
                  }}
                />
              ) : (
                <img
                  src={
                    showOriginal
                      ? (project.originalPlanImageUrl ?? project.planImageUrl)
                      : project.planImageUrl
                  }
                  alt={project.name}
                  className="w-full object-contain max-h-[480px] rounded-sm"
                  style={{ imageRendering: "crisp-edges" }}
                />
              )}

              {/* Badges */}
              {showAiRender && project.aiRenderedPlanUrl && (
                <div className="absolute top-3 right-3 z-10">
                  <span className="bg-violet-100 border border-violet-300 text-violet-700 font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-sm">
                    AI Rendered
                  </span>
                </div>
              )}
              {showRendered && (
                <div className="absolute top-3 right-3 z-10">
                  <span className="bg-emerald-100 border border-emerald-300 text-emerald-700 font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-sm">
                    Color-coded
                  </span>
                </div>
              )}
              {!showOriginal && !showRendered && !showAiRender && project.originalPlanImageUrl && project.originalPlanImageUrl !== project.planImageUrl && (
                <div className="absolute top-3 right-3">
                  <span className="bg-amber-100 border border-amber-300 text-amber-700 font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-sm">
                    Enhanced
                  </span>
                </div>
              )}
            </div>

            {/* AI Render button — shown below the plan */}
            {analysis?.rooms?.length && !project.aiRenderedPlanUrl && !showAiRender && (
              <button type="button" onClick={triggerAiRender} disabled={aiRendering}
                className="w-full mt-2 btn-secondary flex items-center justify-center gap-2 py-2.5">
                {aiRendering ? (
                  <><span className="spinner w-3 h-3" style={{borderWidth: 1}} /> Generating AI render…</>
                ) : (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg> Generate AI Rendered Plan</>
                )}
              </button>
            )}
            {aiRenderError && (
              <p className="text-xs text-red-500 mt-1">{aiRenderError}</p>
            )}

            <div className="flex items-center justify-between mt-2">
              <p className="font-mono text-[10px] text-stone-400">{project.planImageUrl.split("/").pop()}</p>
              {analysis?.totalAreaSqm && (
                <p className="font-mono text-[10px] text-stone-400">~{analysis.totalAreaSqm} m² total</p>
              )}
            </div>

            {/* Enhancement notes */}
            {enhNotes.length > 0 && (
              <div className="mt-3 border border-stone-100 rounded-sm p-3 space-y-1">
                <p className="font-mono text-[9px] uppercase tracking-widest text-stone-400 mb-1.5">
                  Image processing applied
                </p>
                {enhNotes.map((note, i) => (
                  <p key={i} className="font-mono text-[9px] text-stone-400">· {note}</p>
                ))}
              </div>
            )}
          </div>

          {/* Site context summary — always visible */}
          {project.plotInfo && <PlotInfoPanel plotInfo={project.plotInfo} projectId={id} />}
        </div>

        {/* ── Right col: analysis panel ────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5 fade-up fade-up-3">
          {!analysis ? (
            <AnalysePrompt
              analysing={analysing}
              analysisStep={analysisStep}
              hasPlotInfo={!!project.plotInfo}
              onAnalyse={runAnalysis}
            />
          ) : (
            <>
              <RoomsCard
                analysis={analysis}
                onUpdate={(updated) => setAnalysis(updated)}
              />
              <StrengthsCard
                strengths={strengths}
                analysing={analysing}
                onRegenerate={runAnalysis}
                onChange={setStrengths}
              />
              {/* Inline error */}
              {error && (
                <div className="border border-red-200 bg-red-50 rounded-sm px-3 py-2.5 flex items-start gap-2">
                  <span className="text-red-400 flex-shrink-0 text-xs mt-0.5">✕</span>
                  <div className="flex-1">
                    <p className="text-xs text-red-700 leading-relaxed">{error}</p>
                    <button type="button" onClick={() => setError(null)}
                      className="font-mono text-[9px] text-red-400 mt-1 underline">Dismiss</button>
                  </div>
                </div>
              )}

              <button
                onClick={saveAndContinue}
                disabled={saving || strengths.length === 0}
                className="btn-primary w-full justify-center"
              >
                {saving ? (
                  <><span className="spinner" /><span>Saving…</span></>
                ) : (
                  <><span>{isConcept ? "Save & Continue to Export" : "Save & Continue to Moodboards"}</span><span>→</span></>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Plot info panel ──────────────────────────────────────────────────────────

function PlotInfoPanel({ plotInfo, projectId }: { plotInfo: PlotInfo; projectId: string }) {
  const [open, setOpen] = useState(true);

  const rows: { label: string; value: string | number | boolean | undefined }[] = [
    { label: "Plot / Carpet Area",  value: plotInfo.plotAreaSqm      ? `${plotInfo.plotAreaSqm} sqm`      : undefined },
    { label: "Built-up Area",       value: plotInfo.builtUpAreaSqm   ? `${plotInfo.builtUpAreaSqm} sqm`   : undefined },
    { label: "Facing",              value: plotInfo.facing },
    { label: "Property Type",       value: plotInfo.propertyType },
    { label: "Bedrooms",            value: plotInfo.numberOfBedrooms  ? `${plotInfo.numberOfBedrooms} BHK` : undefined },
    { label: "Floor",               value: plotInfo.floorLocation     ? `${plotInfo.floorLocation} floor`  : undefined },
    { label: "Floors in Building",  value: plotInfo.numberOfFloors },
    { label: "Vaastu",              value: plotInfo.vaastuCompliance  ? "Yes — compliance required"       : undefined },
    { label: "Notes",               value: plotInfo.additionalNotes },
  ].filter((r) => r.value !== undefined && r.value !== "");

  if (rows.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <CompassIcon />
          <p className="font-mono text-xs tracking-widest text-stone-500 uppercase">Site Context</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-stone-400">{rows.length} fields</span>
          <span className={`text-stone-400 transition-transform text-xs ${open ? "rotate-180" : ""}`}>▾</span>
        </div>
      </button>

      {open && (
        <>
          <div className="border-t border-stone-100 divide-y divide-stone-100">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start justify-between px-5 py-2.5 gap-4">
                <span className="font-mono text-[10px] uppercase tracking-widest text-stone-400 pt-0.5 flex-shrink-0">
                  {r.label}
                </span>
                <span className="text-sm text-stone-700 text-right leading-snug">
                  {String(r.value)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-stone-100 px-5 py-3">
            <a
              href={`/project/${projectId}/new`}
              className="btn-ghost text-[10px] pl-0 text-stone-400 hover:text-stone-700"
            >
              ✎ Edit site details
            </a>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Analyse prompt card ──────────────────────────────────────────────────────

function AnalysePrompt({
  analysing,
  analysisStep,
  hasPlotInfo,
  onAnalyse,
}: {
  analysing: boolean;
  analysisStep: string;
  hasPlotInfo: boolean;
  onAnalyse: () => void;
}) {
  return (
    <div className="card p-8 text-center space-y-5">
      <div className={`w-12 h-12 border rounded-sm flex items-center justify-center mx-auto transition-colors ${analysing ? "border-amber-300 bg-amber-50" : "border-stone-200"}`}>
        {analysing ? (
          <span className="spinner w-5 h-5 text-amber-500" style={{ borderWidth: 1.5 }} />
        ) : (
          <svg className="w-6 h-6 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        )}
      </div>

      {analysing ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-stone-700">{analysisStep || "Starting…"}</p>
          <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest animate-pulse">
            This takes 10–30 seconds
          </p>
          {/* Step progress dots */}
          <div className="flex justify-center gap-1.5 pt-1">
            {["Enhance", "Read", "Rooms", "Strengths"].map((label, i) => {
              const stepIndex = ["Enhancing", "Reading", "Identifying", "Drafting"].findIndex(
                s => (analysisStep || "").startsWith(s)
              );
              return (
                <div key={label} className="flex flex-col items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i <= stepIndex ? "bg-amber-400" : "bg-stone-200"
                  }`} />
                  <span className="font-mono text-[8px] text-stone-300">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium text-stone-800 mb-1">Analyse the plan</p>
          <p className="text-xs text-stone-400 leading-relaxed">
            AI will detect rooms, estimate areas, and draft client-friendly plan strengths.
            {hasPlotInfo && (
              <span className="block mt-1 text-amber-600 font-mono uppercase tracking-wider text-[10px]">
                ✓ Site context will be used
              </span>
            )}
          </p>
        </div>
      )}

      <button onClick={onAnalyse} disabled={analysing} className="btn-primary w-full justify-center">
        {analysing ? (
          <><span className="spinner" /><span>{analysisStep || "Analysing…"}</span></>
        ) : (
          "Analyse Plan"
        )}
      </button>
    </div>
  );
}

// ─── Rooms card (editable) ────────────────────────────────────────────────────

function RoomsCard({
  analysis,
  onUpdate,
}: {
  analysis: PlanAnalysis;
  onUpdate: (updated: PlanAnalysis) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  function updateRoom(index: number, patch: Partial<typeof analysis.rooms[0]>) {
    const rooms = analysis.rooms.map((r, i) => i === index ? { ...r, ...patch } : r);
    onUpdate({ ...analysis, rooms });
  }

  function removeRoom(index: number) {
    const rooms = analysis.rooms.filter((_, i) => i !== index);
    onUpdate({ ...analysis, rooms });
  }

  function addRoom() {
    const rooms = [...analysis.rooms, { name: "New Room", sizeEstimateSqm: 10 }];
    onUpdate({ ...analysis, rooms });
    setExpanded("New Room");
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Rooms Detected</p>
        <span className="font-mono text-xs text-stone-400">{analysis.rooms.length} rooms</span>
      </div>

      <p className="text-[10px] font-mono text-stone-400">
        Click any room to edit name, area, or notes.
      </p>

      <div className="space-y-1">
        {analysis.rooms.map((room, i) => (
          <div key={i} className="border border-stone-100 rounded-sm overflow-hidden">
            {/* Row header */}
            <button
              type="button"
              onClick={() => setExpanded(expanded === room.name + i ? null : room.name + i)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-stone-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="font-mono text-[9px] text-stone-300 w-5 flex-shrink-0">{String(i+1).padStart(2,"0")}</span>
                <span className="text-sm text-stone-700 truncate">{room.name}</span>
                {room.specialFeatures && room.specialFeatures.length > 0 && (
                  <span className="font-mono text-[8px] text-stone-400 hidden sm:inline truncate">
                    {room.specialFeatures[0]}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {room.sizeEstimateSqm && (
                  <span className="font-mono text-[10px] text-stone-400">{room.sizeEstimateSqm} m²</span>
                )}
                <span className="text-stone-300 text-xs">{expanded === room.name + i ? "▲" : "▾"}</span>
              </div>
            </button>

            {/* Expanded edit form */}
            {expanded === room.name + i && (
              <div className="border-t border-stone-100 px-3 py-3 bg-stone-50 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label text-[9px]">Room Name</label>
                    <input className="field-input text-xs py-1.5" value={room.name}
                      onChange={(e) => updateRoom(i, { name: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label text-[9px]">Area (sqm)</label>
                    <input className="field-input text-xs py-1.5" type="number" value={room.sizeEstimateSqm ?? ""}
                      onChange={(e) => updateRoom(i, { sizeEstimateSqm: Number(e.target.value) })} />
                  </div>
                </div>
                <div>
                  <label className="field-label text-[9px]">Notes</label>
                  <input className="field-input text-xs py-1.5" value={room.notes ?? ""}
                    placeholder="e.g. south-facing, ensuite attached"
                    onChange={(e) => updateRoom(i, { notes: e.target.value })} />
                </div>
                <div className="flex justify-end pt-1">
                  <button type="button"
                    onClick={() => removeRoom(i)}
                    className="font-mono text-[9px] text-red-400 hover:text-red-600 uppercase tracking-widest">
                    Remove room
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add room + tags */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex flex-wrap gap-1.5">
          {analysis.hasBalcony    && <Tag>Balcony</Tag>}
          {analysis.hasClearZoning && <Tag>Clear zoning</Tag>}
          {analysis.totalAreaSqm  && <Tag>{analysis.totalAreaSqm} m²</Tag>}
          <Tag>{analysis.circulationQuality ?? "comfortable"} circulation</Tag>
        </div>
        <button type="button" onClick={addRoom}
          className="btn-ghost text-[10px] pl-0">
          + Add room
        </button>
      </div>

      {analysis.comments && analysis.comments.length > 0 && (
        <div className="border-t border-stone-100 pt-3 space-y-1">
          {analysis.comments.map((c, i) => (
            <p key={i} className="text-[11px] text-stone-500 leading-relaxed">· {c}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Strengths card ───────────────────────────────────────────────────────────

function StrengthsCard({
  strengths,
  analysing,
  onRegenerate,
  onChange,
}: {
  strengths: string[];
  analysing: boolean;
  onRegenerate: () => void;
  onChange: (s: string[]) => void;
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Plan Strengths</p>
        <button onClick={onRegenerate} disabled={analysing} className="btn-ghost text-[10px]">
          {analysing ? "Regenerating…" : "↻ Regenerate"}
        </button>
      </div>
      <p className="text-[10px] font-mono text-stone-400">
        Edit these bullets before saving — they appear in the client PDF.
      </p>
      <div className="space-y-2">
        {strengths.map((s, i) => (
          <div key={i} className="flex items-start gap-2 group">
            <span className="font-mono text-[10px] text-stone-300 pt-2.5 w-5 flex-shrink-0">
              {String(i + 1).padStart(2, "0")}
            </span>
            <textarea
              className="field-input text-sm resize-none flex-1"
              rows={2}
              value={s}
              onChange={(e) => {
                const next = [...strengths];
                next[i] = e.target.value;
                onChange(next);
              }}
              placeholder="Strength description…"
            />
            <button
              type="button"
              onClick={() => onChange(strengths.filter((_, idx) => idx !== i))}
              className="btn-ghost opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600 p-1 mt-1"
            >×</button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn-ghost text-[10px] pl-0"
        onClick={() => onChange([...strengths, ""])}
      >
        + Add bullet
      </button>
    </div>
  );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 border border-stone-200 rounded-sm font-mono text-[9px] tracking-widest uppercase text-stone-500">
      {children}
    </span>
  );
}

function CompassIcon() {
  return (
    <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 12l2-2 4 4-2 2-4-4z" />
    </svg>
  );
}

function PageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-8">
      <div className="skeleton h-6 w-64" />
      <div className="skeleton h-8 w-48" />
      <div className="grid grid-cols-5 gap-8">
        <div className="col-span-3 space-y-4">
          <div className="skeleton h-[400px]" />
          <div className="skeleton h-32" />
        </div>
        <div className="col-span-2 space-y-4">
          <div className="skeleton h-48" />
          <div className="skeleton h-48" />
        </div>
      </div>
    </div>
  );
}

/** Renders a single-page PDF to a <canvas> element using pdfjs-dist in the browser. */

function PdfPageThumb({ pdfUrl }: { pdfUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendered  = useRef(false);

  const renderPdf = useCallback(async (canvas: HTMLCanvasElement | null) => {
    if (!canvas || rendered.current) return;
    rendered.current = true;
    canvasRef.current = canvas;

    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      const res     = await fetch(pdfUrl);
      const data    = new Uint8Array(await res.arrayBuffer());
      const doc     = await pdfjsLib.getDocument({ data }).promise;
      const page    = await doc.getPage(1);

      // Fit into the thumbnail container (scale ~1.5 is enough for a preview)
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;

      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      doc.destroy();
    } catch (err) {
      console.error("PDF thumbnail render failed:", err);
    }
  }, [pdfUrl]);

  return (
    <canvas
      ref={renderPdf}
      className="w-full h-full object-contain"
      style={{ maxWidth: "100%", maxHeight: "100%" }}
    />
  );
}
