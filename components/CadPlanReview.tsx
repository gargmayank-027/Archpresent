"use client";

/**
 * components/CadPlanReview.tsx
 *
 * The CAD-path counterpart to the image-path review UI in
 * app/project/[id]/review/page.tsx. Deliberately a SEPARATE, self-contained
 * component rather than a modification of the existing 1000+ line review
 * page — per the migration plan (§5, Phase 5): the existing image-path JSX
 * is not touched at all, this is mounted via one early-return branch.
 *
 * No "Analyze" step is needed here (unlike the image path): room geometry
 * and classification already come from the DXF at upload time
 * (app/api/cad/upload/route.ts), so this page's job is purely
 * presentation + theme selection, not AI orchestration.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StepIndicator } from "@/components/StepIndicator";
import { CadThemePicker } from "@/components/CadThemePicker";
import type { Project } from "@/types";

interface Props {
  project: Project;
  onProjectUpdate: (patch: Partial<Project>) => void;
}

export function CadPlanReview({ project, onProjectUpdate }: Props) {
  const router = useRouter();
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const isConcept = project.presentationType === "concept";
  const STEPS = isConcept
    ? [
        { num: "1", label: "Upload", status: "complete" as const },
        { num: "2", label: "Review", status: "active" as const },
        { num: "3", label: "Export", status: "pending" as const },
      ]
    : [
        { num: "1", label: "Upload", status: "complete" as const },
        { num: "2", label: "Review", status: "active" as const },
        { num: "3", label: "Moodboards", status: "pending" as const },
        { num: "4", label: "Export", status: "pending" as const },
      ];

  async function handleThemeChange(themeKey: string) {
    if (themeKey === project.cadTheme) return;
    setRendering(true);
    setRenderError(null);
    try {
      const res = await fetch("/api/cad/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, theme: themeKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Re-render failed");
      onProjectUpdate({
        renderedPlanUrl: data.renderedPlanUrl,
        planImageUrl: data.renderedPlanUrl,
        cadTheme: data.cadTheme,
        cadWarnings: data.warnings,
        analysis: { ...(project.analysis ?? { rooms: [] }), rooms: data.rooms },
      });
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "Re-render failed");
    } finally {
      setRendering(false);
    }
  }

  function handleContinue() {
    router.push(isConcept ? `/project/${project.id}/export` : `/project/${project.id}/moodboards`);
  }

  const rooms = project.analysis?.rooms ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
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
          Imported from CAD — walls, rooms, and furniture are drawn exactly as in your file.
          Pick a theme, then continue.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* ── Left: plan preview ──────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-5 fade-up fade-up-2">
          <div>
            <p className="font-mono text-xs tracking-widest text-stone-400 uppercase mb-3">Floor Plan</p>
            <div className="card p-4 bg-white relative overflow-hidden">
              {rendering && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                  <span className="spinner w-6 h-6 text-stone-400" />
                </div>
              )}
              <img
                src={project.renderedPlanUrl ?? project.planImageUrl}
                alt="CAD floor plan"
                className="w-full object-contain max-h-[480px] rounded-sm"
              />
            </div>
            {renderError && <p className="text-xs text-red-500 mt-2">{renderError}</p>}
          </div>

          {project.cadWarnings && project.cadWarnings.length > 0 && (
            <div className="border border-stone-100 rounded-sm p-3 space-y-1">
              <p className="font-mono text-[9px] uppercase tracking-widest text-stone-400 mb-1.5">
                Notes from the CAD parser
              </p>
              {project.cadWarnings.map((w, i) => (
                <p key={i} className="font-mono text-[9px] text-stone-400">· {w.message}</p>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: theme + room list ─────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5 fade-up fade-up-3">
          <div className="card p-4 bg-white">
            <CadThemePicker
              value={project.cadTheme ?? "modern"}
              onChange={handleThemeChange}
              disabled={rendering}
            />
          </div>

          <div className="card p-4 bg-white">
            <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase mb-3">
              Rooms ({rooms.length})
            </p>
            <div className="space-y-2">
              {rooms.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-stone-50 pb-2 last:border-0">
                  <span className="text-stone-700">{r.name}</span>
                  <span className="font-mono text-[10px] text-stone-400">
                    {r.sizeEstimateSqm ? `${r.sizeEstimateSqm} m²` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button type="button" onClick={handleContinue} disabled={rendering}
            className="w-full btn-primary py-3">
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
