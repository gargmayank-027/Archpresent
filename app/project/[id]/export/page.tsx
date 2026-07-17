"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StepIndicator } from "@/components/StepIndicator";
import { PDF_THEME_META } from "@/lib/pdfThemeMeta";
import type { Project } from "@/types";

export default function ExportPage() {
  const { id } = useParams<{ id: string }>();

  const [project,     setProject]     = useState<Project | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [exporting,   setExporting]   = useState(false);
  const [reanalysing, setReanalysing] = useState(false);
  const [exportDone,  setExportDone]  = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);

  // Real-PDF preview — the actual generated PDF, rendered client-side with
  // pdf.js. `pdfBytes` is kept in state so the Download button reuses these
  // exact bytes instead of re-generating the PDF a second time — preview
  // and download can never show two different documents.
  const [pageImages,     setPageImages]     = useState<string[] | null>(null);
  const [pdfBytes,       setPdfBytes]       = useState<ArrayBuffer | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError,   setPreviewError]   = useState<string | null>(null);
  const [themeSaving,    setThemeSaving]    = useState(false);
  const [pageLabels,     setPageLabels]     = useState<string[] | null>(null);

  // Share link state
  const [shareUrl,     setShareUrl]     = useState<string | null>(null);
  const [shareExpiry,  setShareExpiry]  = useState("never");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied,  setShareCopied]  = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareViews,   setShareViews]   = useState(0);

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  const isConcept = project?.presentationType === "concept";

  const STEPS = isConcept
    ? [
        { num: "1", label: "Upload",  status: "complete" as const },
        { num: "2", label: "Review",  status: "complete" as const },
        { num: "3", label: "Export",  status: "active"   as const },
      ]
    : [
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

  async function loadPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      // Refetch the project too. This page reads `analysis` for the readiness
      // gate and slide list, but only loaded it once on mount — so an analysis
      // that finished afterwards left the page insisting it was still pending.
      fetch(`/api/projects/${id}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => { if (d.project) setProject(d.project); })
        .catch(() => { /* preview is the important part; keep going */ });

      const res = await fetch(`/api/export/preview?projectId=${id}`, { cache: "no-store" });
      if (!res.ok) {
        // Distinguish "the server couldn't build the PDF" from "your browser
        // couldn't render it". Completely different causes; the old message
        // ("Couldn't render the live preview") covered both and so told nobody
        // anything actionable.
        let detail = String(res.status);
        try { const b = await res.json(); if (b?.error) detail = b.error; } catch { /* non-JSON body */ }
        throw new Error(`Server couldn't build this PDF — ${detail}`);
      }

      // Labels come from the PDF builder itself — one per real page — so the
      // filmstrip can never drift from the document again.
      try {
        const raw = res.headers.get("X-Deck-Page-Labels");
        if (raw) setPageLabels(JSON.parse(decodeURIComponent(raw)));
      } catch { setPageLabels(null); }

      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0) throw new Error("Server returned an empty PDF");
      setPdfBytes(bytes);

      // Render every page of the ACTUAL PDF to an image, client-side. This
      // is the same file the Download button will hand out, so what you see
      // here is guaranteed byte-identical to what you download — there's no
      // separate mockup that can drift out of sync.
      // Worker is served same-origin from public/, copied out of node_modules
      // by scripts/copy-pdf-worker.mjs at build time. Two reasons not to point
      // this at a CDN: it's an external runtime dependency for a core feature,
      // and pdf.js wraps cross-origin workers in a generated blob shim
      // (PDFWorker._createCDNWrapper) — an extra fetch we don't need.
      //
      // Do NOT use `new URL("pdfjs-dist/build/pdf.worker.min.mjs",
      // import.meta.url)` here: that makes webpack emit the worker as a bundled
      // asset, which Next's minifier then parses as a classic script and fails
      // on the ESM syntax inside.
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

      // Confirm the worker is actually being served. It's generated into
      // public/ by scripts/copy-pdf-worker.mjs via the prebuild hook, so a 404
      // here means that step didn't run on this deploy — worth saying plainly
      // rather than surfacing pdf.js's opaque "fake worker" failure.
      const probe = await fetch("/pdf.worker.min.mjs", { method: "HEAD" });
      if (!probe.ok) {
        throw new Error("PDF renderer missing at /pdf.worker.min.mjs — the prebuild step didn't run on this deploy");
      }

      const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      const images: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
        images.push(canvas.toDataURL("image/jpeg", 0.85));
      }
      setPageImages(images);
    } catch (err) {
      console.error("[export] preview failed", err);
      setPageImages(null);
      setPreviewError(err instanceof Error ? err.message : "Couldn't render the live preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    loadProject();
    loadPreview();
    // Re-fetch whenever the tab/window regains focus — covers the common
    // case of editing moodboards in another tab, or coming back via
    // browser back/forward (bfcache) where this effect wouldn't re-run.
    function onFocus() { loadProject(); loadPreview(); }
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
      // Reuse the exact bytes already rendered in the preview above, so the
      // download can never be a different PDF than what was just shown. Only
      // hit the server again if the preview hasn't finished loading yet.
      let bytes = pdfBytes;
      if (!bytes) {
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
        bytes = await res.arrayBuffer();
      }
      const blob = new Blob([bytes], { type: "application/pdf" });
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

  async function reanalysePlan() {
    setReanalysing(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
      });
      if (res.ok) {
        const data = await res.json();
        setProject((p) => p ? { ...p, analysis: data.analysis } : p);
        loadPreview();
      }
    } catch { /* ignore */ } finally {
      setReanalysing(false);
    }
  }

  if (loading)  return <PageSkeleton />;
  if (!project) return <div className="p-12 text-center text-stone-400">Project not found.</div>;

  const { analysis, planStrengths = [], moodboards = [], styleProfile,
          overallMoodboard, roomMoodboards = [] } = project;
  // Export/share readiness.
  //
  // This used to be `planStrengths.length > 0`, which used strengths as a
  // proxy for "the analysis ran". If the vision pass produced rooms but no
  // strengths — or strengths failed to save — the architect was blocked with
  // "Complete plan analysis first" for something they had already done, and
  // with no way to tell what was actually missing.
  //
  // Rooms are the real signal: without them the deck has no walkthrough and no
  // Why-This-Works, which is most of its value. Strengths are optional — that
  // slide is simply skipped.
  const hasAnalysis  = Boolean(analysis);
  const hasRooms     = (analysis?.rooms?.length ?? 0) > 0;
  const isReady      = hasRooms;

  const notReadyReason = hasRooms
    ? null
    : !hasAnalysis
    ? "This plan hasn't been analysed yet."
    : "The analysis finished but found no rooms — it may have failed partway.";

  // Build slide deck — mirrors PDF page order, branches on presentation type

  const slides: SlidePreview[] = [
    { type: "cover", label: "Cover", icon: "01" },
    ...(project.plotInfo && Object.keys(project.plotInfo).length > 0
      ? [{ type: "site" as const, label: "Site Context", icon: "02" }]
      : []),
    { type: "plan", label: "Floor Plan", icon: "03", imageUrl: project.aiRenderedPlanUrl ?? project.renderedPlanUrl ?? project.planImageUrl },
    ...(planStrengths.length > 0
      ? [{ type: "strengths" as const, label: "Plan Strengths", icon: "04" }]
      : []),

    // ── Concept-specific slides ──
    ...(isConcept && (analysis?.rooms?.length ?? 0) > 0
      ? [{ type: "walkthrough" as const, label: "Room Walkthrough", icon: "05" }]
      : []),
    ...(isConcept && (analysis?.rooms?.length ?? 0) > 0
      ? [{ type: "highlights" as const, label: "Why This Works", icon: "06" }]
      : []),
    ...(isConcept && project.plotInfo?.showVastu && project.plotInfo?.facing
      ? [{ type: "vastu" as const, label: "Vastu Analysis", icon: "07" }]
      : []),

    // ── Interior-specific slides ──
    ...(!isConcept && overallMoodboard
      ? [{ type: "overall-mood" as const, label: "Overall Style", icon: "05",
           imageUrl: overallMoodboard.images[0]?.url }]
      : []),
    ...(!isConcept && roomMoodboards.length > 0
      ? roomMoodboards.map((rm, i) => ({
          type: "room-mood" as const,
          label: rm.roomName,
          icon: String(i + 6).padStart(2, "0"),
          imageUrl: rm.images[0]?.url,
          roomName: rm.roomName,
          planSnippetUrl: rm.planSnippetUrl,
          images: rm.images,
        }))
      : !isConcept ? moodboards.map((mb, i) => ({
          type: "moodboard" as const,
          label: mb.roomName,
          icon: String(i + 6).padStart(2, "0"),
          imageUrl: mb.imageUrl,
          roomName: mb.roomName,
        })) : []
    ),

    // Thank you slide
    { type: "thankyou" as const, label: "Thank You", icon: "" },
  ];

  // What the filmstrip actually shows.
  //
  // Derived from the labels the PDF builder emitted — one entry per real page —
  // so it can never drift from the document. The `slides` array above is now
  // only a pre-load placeholder: it had no Thank You entry and assumed one page
  // per section, so it dropped the closing slide and mislabelled everything
  // after the walkthrough began paginating.
  const previewItems: { label: string; fromPdf: boolean }[] =
    pageLabels && pageLabels.length > 0
      ? pageLabels.map((label) => ({ label, fromPdf: true }))
      : slides.map((sl) => ({ label: sl.label, fromPdf: false }));


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
              {previewItems.length}-slide 16:9 PDF deck — preview each slide below before exporting.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Style preset selector — drives the actual PDF (lib/pdfTheme.ts) */}
            <div className="flex items-center gap-1 border border-stone-200 rounded-sm overflow-hidden">
              {PDF_THEME_META.map((th) => (
                <button key={th.id}
                  title={th.description}
                  disabled={themeSaving}
                  onClick={async () => {
                    if ((project?.presentationTheme ?? "classic") === th.id) return;
                    setThemeSaving(true);
                    try {
                      await fetch(`/api/projects/${id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ presentationTheme: th.id }),
                      });
                      setProject(p => p ? { ...p, presentationTheme: th.id } : p);
                      // Re-render the preview against the new preset. Without
                      // this the firm changes the theme and sees nothing move.
                      setPdfBytes(null);
                      await loadPreview();
                    } finally {
                      setThemeSaving(false);
                    }
                  }}
                  className={`px-3 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-50 ${
                    (project?.presentationTheme ?? "classic") === th.id
                      ? "bg-stone-900 text-white"
                      : "text-stone-400 hover:text-stone-700"
                  }`}>
                  {th.label}
                </button>
              ))}
            </div>

            <button onClick={reanalysePlan} disabled={reanalysing || exporting}
              className="btn-ghost text-xs" title="Re-run plan analysis">
              {reanalysing ? <><span className="spinner w-3 h-3" style={{borderWidth:1}} /><span>Re-analysing…</span></> : "Re-analyse"}
            </button>
            {!isConcept && (
              <a href={`/project/${id}/moodboards`} className="btn-secondary">
                ← Edit Moodboards
              </a>
            )}
            {isConcept && (
              <a href={`/project/${id}/review`} className="btn-secondary">
                ← Edit Review
              </a>
            )}
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
            {notReadyReason}{" "}
            <a href={`/project/${id}/review`} className="underline underline-offset-2">Go to Review →</a>
            {hasAnalysis && !hasRooms && (
              <span className="block mt-1 text-xs text-stone-400">
                Try Re-analyse on the review page. If it keeps finding no rooms, the plan image may be
                too low-resolution or the room labels unreadable.
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Main slide preview area ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 fade-up fade-up-2">

        {/* Slide filmstrip — left column */}
        <div className="lg:col-span-1 space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-3">
            Slides ({previewItems.length})
          </p>
          <div className="space-y-1.5 filmstrip pr-1">
            {previewItems.map((slide, i) => (
              <button key={i} type="button"
                onClick={() => setActiveSlide(i)}
                className={`w-full text-left group transition-all ${
                  activeSlide === i
                    ? "ring-1 ring-stone-900"
                    : "hover:ring-1 hover:ring-stone-300"
                }`}>
                {/* Mini 16:9 thumbnail — the real PDF page when available */}
                <div className="aspect-video overflow-hidden rounded-sm relative bg-stone-100">
                  {pageImages?.[i] ? (
                    <img src={pageImages[i]} alt={slide.label}
                      className="absolute inset-0 w-full h-full object-cover" />
                  ) : slide.fromPdf ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="spinner w-3 h-3" style={{ borderWidth: 1 }} />
                    </div>
                  ) : slides[i] ? (
                    <SlideThumbnail slide={slides[i]} project={project} />
                  ) : null}
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
          <div className="aspect-video rounded-sm overflow-hidden shadow-lg ring-1 ring-stone-200 bg-stone-100 relative">
            {previewLoading && !pageImages ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="spinner" />
              </div>
            ) : pageImages?.[activeSlide] ? (
              <img src={pageImages[activeSlide]} alt={previewItems[activeSlide]?.label}
                className="absolute inset-0 w-full h-full object-contain" />
            ) : previewItems[activeSlide]?.fromPdf ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="spinner" />
              </div>
            ) : (
              <SlidePreviewLarge slide={slides[activeSlide]} project={project} />
            )}
          </div>
          {previewError && (
            <p className="text-xs text-red-500 -mt-2">
              {previewError}.{" "}
              <button type="button" onClick={loadPreview} className="underline underline-offset-2">
                Retry
              </button>
            </p>
          )}

          {/* Slide navigation */}
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))}
              disabled={activeSlide === 0}
              className="slide-nav-btn">
              ← Prev
            </button>
            <span className="font-mono text-xs text-stone-400">
              {activeSlide + 1} / {slides.length}
            </span>
            <button type="button" onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))}
              disabled={activeSlide === slides.length - 1}
              className="slide-nav-btn">
              Next →
            </button>
          </div>

          {/* Slide detail panel. The filmstrip is driven by real PDF pages,
              which can outnumber the legacy `slides` array (it has no Thank You
              entry and assumes one page per section), so this is only rendered
              when there's a matching descriptor. */}
          {slides[activeSlide] && (
            <SlideDetailPanel slide={slides[activeSlide]} project={project} slideIndex={activeSlide} />
          )}
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
            <div className="flex items-center gap-3">
              {project?.shareLastViewedAt && (
                <span className="font-mono text-[9px] text-stone-400">
                  Last viewed {timeAgo(project.shareLastViewedAt)}
                </span>
              )}
              <span className="font-mono text-[10px] text-stone-400 bg-stone-100 px-2 py-1 rounded-sm">
                {shareViews} {shareViews === 1 ? "view" : "views"}
              </span>
            </div>
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
                <a href={shareEnabled ? `https://wa.me/?text=${encodeURIComponent(`Here's the concept presentation for ${project?.name ?? "your project"}: ${shareUrl}`)}` : "#"}
                  target="_blank" rel="noreferrer"
                  className={`btn-secondary flex-shrink-0 ${!shareEnabled ? "pointer-events-none opacity-40" : ""}`}
                  style={{ background: shareEnabled ? "#25D366" : undefined, borderColor: shareEnabled ? "#25D366" : undefined, color: shareEnabled ? "#fff" : undefined }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.61.609l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.387 0-4.592-.828-6.328-2.213l-.15-.12-3.278 1.098 1.098-3.278-.12-.15A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                  <span>WhatsApp</span>
                </a>
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

      {/* ── Client Feedback ──────────────────────────────────────────────── */}
      {(project.clientFeedback ?? []).length > 0 && (
        <div className="mt-6 card p-6 fade-up fade-up-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs tracking-widest text-stone-400 uppercase">Client Feedback</h3>
            <span className="font-mono text-[10px] text-stone-400 bg-stone-100 px-2 py-0.5 rounded-sm">
              {project.clientFeedback!.length} {project.clientFeedback!.length === 1 ? "response" : "responses"}
            </span>
          </div>

          {/* Reaction summary */}
          <div className="flex gap-4 mb-4 pb-4 border-b border-stone-100">
            {[
              { emoji: "❤️", label: "Love", value: "love" },
              { emoji: "👍", label: "Like", value: "like" },
              { emoji: "🤔", label: "Thinking", value: "neutral" },
              { emoji: "💭", label: "Concern", value: "concern" },
            ].map((r) => {
              const count = project.clientFeedback!.filter((f) => f.reaction === r.value).length;
              return count > 0 ? (
                <div key={r.value} className="flex items-center gap-1.5">
                  <span className="text-sm">{r.emoji}</span>
                  <span className="font-mono text-[10px] text-stone-500">{count}</span>
                </div>
              ) : null;
            })}
          </div>

          {/* Individual comments */}
          <div className="space-y-3 max-h-48 overflow-y-auto">
            {project.clientFeedback!
              .filter((f) => f.comment)
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((f) => (
                <div key={f.id} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] text-stone-500 font-medium uppercase">
                      {f.clientName[0]}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-stone-700 font-medium">{f.clientName}</span>
                      {f.reaction && <span className="text-xs">
                        {f.reaction === "love" ? "❤️" : f.reaction === "like" ? "👍" : f.reaction === "neutral" ? "🤔" : "💭"}
                      </span>}
                      <span className="text-[9px] text-stone-400">
                        {f.slideIndex !== null ? `Slide ${f.slideIndex + 1}` : ""} · {timeAgo(f.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-stone-500 mt-0.5">{f.comment}</p>
                  </div>
                </div>
              ))}
            {project.clientFeedback!.filter((f) => f.comment).length === 0 && (
              <p className="text-xs text-stone-400">Reactions received but no written comments yet.</p>
            )}
          </div>
        </div>
      )}

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
  type: "cover" | "site" | "plan" | "strengths" | "walkthrough" | "highlights" | "vastu" | "moodboard" | "overall-mood" | "room-mood" | "thankyou";
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

  if (slide.type === "walkthrough") {
    const rooms = project.analysis?.rooms ?? [];
    return (
      <div className="w-full h-full bg-[#1a1917] flex flex-col p-6 overflow-hidden">
        <p className="font-mono text-[10px] tracking-[0.2em] text-amber-500/80 uppercase mb-1">A Walk Through Your Home</p>
        <p className="text-white/30 text-xs mb-4">Every space designed with purpose.</p>
        <div className="flex-1 grid grid-cols-2 gap-x-8 gap-y-2 overflow-hidden">
          {rooms.slice(0, 12).map((r) => (
            <div key={r.name} className="flex gap-2">
              <div className="w-1 h-full bg-amber-500/20 rounded flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-white/80 text-xs font-medium truncate">{r.name}</p>
                <p className="text-white/30 text-[9px]">
                  {r.sizeEstimateSqm ? `${r.sizeEstimateSqm}m2` : ""} {r.orientation ?? ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slide.type === "highlights") {
    const rooms = project.analysis?.rooms ?? [];
    const facing = project.plotInfo?.facing ?? "";
    const insights: string[] = [];
    const beds = rooms.filter(r => r.name.toLowerCase().includes("bed")).length;
    if (beds > 0) insights.push(`${beds} bedroom${beds > 1 ? "s" : ""} with privacy zoning`);
    if (facing) insights.push(`${facing}-facing orientation advantage`);
    if (rooms.some(r => r.name.toLowerCase().includes("pooja"))) insights.push("Dedicated Pooja room");
    if (rooms.some(r => r.name.toLowerCase().includes("serv"))) insights.push("Dual kitchen setup");
    insights.push("Efficient circulation design");

    return (
      <div className="w-full h-full bg-[#1a1917] flex flex-col justify-center p-8">
        <p className="font-mono text-[10px] tracking-[0.2em] text-amber-500/80 uppercase mb-1">Why This Plan Works</p>
        <p className="text-white/30 text-xs mb-6">Key design decisions for everyday living.</p>
        <div className="space-y-4">
          {insights.slice(0, 5).map((item, i) => (
            <div key={i} className="flex gap-3 items-start">
              <span className="font-mono text-amber-500/50 text-xs w-5 flex-shrink-0">{String(i+1).padStart(2,"0")}</span>
              <p className="text-white/70 text-sm">{item}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slide.type === "vastu") {
    const facing = project.plotInfo?.facing ?? "";
    const good = facing.toLowerCase().includes("east") || facing.toLowerCase().includes("north");
    return (
      <div className="w-full h-full bg-[#1a1917] flex flex-col justify-center p-8">
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-amber-500/80 uppercase">Vastu Analysis</p>
            <p className="text-white/30 text-xs mt-1">Vastu Shastra compliance check.</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-light text-amber-500/70">{good ? "75%" : "50%"}</p>
            <p className="font-mono text-[8px] text-white/25 uppercase">Vastu Score</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3 py-1.5 border-b border-white/5">
            <span className={`text-xs ${good ? "text-emerald-400" : "text-amber-400/60"}`}>{good ? "OK" : "--"}</span>
            <span className="text-white/60 text-xs">Main Entrance — {facing}</span>
          </div>
          <div className="flex items-center gap-3 py-1.5 border-b border-white/5">
            <span className="text-emerald-400 text-xs">OK</span>
            <span className="text-white/60 text-xs">Room orientations checked</span>
          </div>
        </div>
        <p className="text-white/15 text-[8px] mt-4">Based on AI-detected orientations.</p>
      </div>
    );
  }

  if (slide.type === "thankyou") {
    return (
      <div className="w-full h-full bg-[#1a1917] flex items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-[9px] text-amber-500/50 uppercase tracking-widest mb-3">{project.firmName}</p>
          <h2 className="text-3xl font-light text-white/80 mb-3" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            Thank you
          </h2>
          <p className="text-white/30 text-sm">We look forward to bringing {project.name} to life.</p>
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
    site:         `/project/${project.id}/review`,
    plan:         `/project/${project.id}/review`,
    strengths:    `/project/${project.id}/review`,
    walkthrough:  `/project/${project.id}/review`,
    highlights:   `/project/${project.id}/review`,
    vastu:        `/project/${project.id}/review`,
    thankyou:     `/project/${project.id}/review`,
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
    "overall-mood": `Overall interior style collage — 4 images showing the full design language.`,
    "room-mood":  `${slide.roomName}: plan snippet + mood images.`,
    walkthrough:  `Room-by-room narrative walkthrough — ${project.analysis?.rooms?.length ?? 0} spaces described.`,
    highlights:   `Lifestyle insights — zoning, orientation, and spatial design decisions.`,
    vastu:        `Vastu Shastra compliance check with room-by-room orientation analysis.`,
    thankyou:     `Closing slide with firm name and project details.`,
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
