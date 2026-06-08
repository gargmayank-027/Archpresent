"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Project, FirmProfile } from "@/types";

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [firm,     setFirm]     = useState<FirmProfile | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState<"all" | "created" | "analyzed" | "styled">("all");

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/firm").then((r) => r.json()),
    ]).then(([pd, fd]) => {
      setProjects(pd.projects ?? []);
      setFirm(fd.firm ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = filter === "all"
    ? projects
    : projects.filter((p) => p.status === filter);

  // Stats
  const total    = projects.length;
  const analyzed = projects.filter((p) => ["analyzed","styled","complete"].includes(p.status)).length;
  const exported = projects.filter((p) => p.moodboards && p.moodboards.length > 0).length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">

      {/* ── Hero / firm greeting ─────────────────────────────────────────── */}
      <div className="mb-12 fade-up fade-up-1">
        {firm ? (
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <p className="font-mono text-xs tracking-widest text-stone-400 uppercase mb-2">
                Residential · Floor Plan Presentations
              </p>
              <h1 className="font-display text-5xl font-light text-stone-900 leading-tight mb-3"
                  style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                {firm.name}
              </h1>
              {firm.tagline && (
                <p className="text-stone-400 text-sm font-mono tracking-wide">{firm.tagline}</p>
              )}
            </div>
            <Link href="/project/new" className="btn-primary self-start mt-2">
              <span>+</span><span>New Project</span>
            </Link>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <p className="font-mono text-xs tracking-widest text-stone-400 uppercase mb-4">
                Residential · Floor Plan Presentations
              </p>
              <h1 className="font-display text-5xl md:text-6xl font-light text-stone-900 leading-tight mb-4"
                  style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                From floor plan<br /><em>to client presentation</em>
              </h1>
              <p className="text-stone-500 text-base max-w-lg leading-relaxed">
                Upload a floor plan, get AI-powered room analysis, interior moodboards,
                and a polished PDF deck — in minutes.
              </p>
            </div>
            <div className="flex flex-col gap-3 self-end">
              <Link href="/project/new" className="btn-primary">
                <span>+</span><span>New Project</span>
              </Link>
              <Link href="/settings" className="btn-secondary text-center justify-center">
                Set up firm profile
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ── Stats row (only when projects exist) ────────────────────────── */}
      {total > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-10 fade-up fade-up-2">
          {[
            { label: "Total Projects",   value: total },
            { label: "Plans Analysed",   value: analyzed },
            { label: "With Moodboards",  value: exported },
          ].map((s) => (
            <div key={s.label} className="card p-5 text-center">
              <p className="font-display text-4xl font-light text-stone-800 mb-1"
                 style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                {s.value}
              </p>
              <p className="font-mono text-[10px] tracking-widest uppercase text-stone-400">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Projects section ─────────────────────────────────────────────── */}
      <div className="fade-up fade-up-2">
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <span className="font-mono text-xs tracking-widest text-stone-400 uppercase">Projects</span>
          <div className="flex-1 h-px bg-stone-200" />

          {/* Filter pills */}
          {total > 0 && (
            <div className="flex gap-1">
              {(["all", "created", "analyzed", "styled"] as const).map((f) => (
                <button key={f} type="button"
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 font-mono text-[9px] uppercase tracking-widest rounded-sm transition-colors ${
                    filter === f
                      ? "bg-stone-900 text-white"
                      : "bg-stone-100 text-stone-400 hover:text-stone-700"
                  }`}>
                  {f === "all" ? `All (${total})` : f}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map((i) => (
              <div key={i} className="card p-0 overflow-hidden">
                <div className="skeleton h-40 w-full" />
                <div className="p-5 space-y-2">
                  <div className="skeleton h-4 w-2/3" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 && total === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-mono text-xs text-stone-400 uppercase tracking-widest">
              No {filter} projects
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((project, i) => (
              <ProjectCard key={project.id} project={project} delay={i} />
            ))}
          </div>
        )}
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      {total === 0 && !loading && (
        <div className="mt-20 fade-up fade-up-4">
          <div className="flex items-center gap-4 mb-10">
            <span className="font-mono text-xs tracking-widest text-stone-400 uppercase">How it works</span>
            <div className="flex-1 h-px bg-stone-200" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { num: "01", title: "Upload",    desc: "Upload your floor plan as PNG or PDF from AutoCAD." },
              { num: "02", title: "Analyse",   desc: "AI reads the plan, identifies rooms, and drafts client-friendly strengths." },
              { num: "03", title: "Style",     desc: "Answer 4 questions. AI generates interior moodboards for key rooms." },
              { num: "04", title: "Export",    desc: "Download a polished PDF deck with your firm branding, ready to send." },
            ].map((step) => (
              <div key={step.num} className="space-y-3">
                <p className="font-mono text-2xl text-stone-200">{step.num}</p>
                <p className="font-mono text-xs tracking-widest uppercase text-stone-700">{step.title}</p>
                <p className="text-sm text-stone-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({ project, delay }: { project: Project; delay: number }) {
  const STATUS_LABEL: Record<string, string> = {
    created:  "Uploaded",
    analyzed: "Analysed",
    styled:   "Styled",
    complete: "Complete",
  };
  const STATUS_DOT: Record<string, string> = {
    created:  "bg-stone-300",
    analyzed: "bg-amber-400",
    styled:   "bg-amber-500",
    complete: "bg-green-500",
  };

  const nextStep = (status: string) => {
    if (status === "created")  return `/project/${project.id}/review`;
    if (status === "analyzed") return `/project/${project.id}/moodboards`;
    return `/project/${project.id}/export`;
  };

  // Plot tags
  const tags: string[] = [];
  if (project.plotInfo?.numberOfBedrooms) tags.push(`${project.plotInfo.numberOfBedrooms} BHK`);
  if (project.plotInfo?.facing)           tags.push(project.plotInfo.facing);
  if (project.plotInfo?.propertyType)     tags.push(project.plotInfo.propertyType);

  return (
    <Link href={nextStep(project.status)}
      className="card overflow-hidden group hover:border-stone-400 transition-all hover:shadow-sm fade-up"
      style={{ animationDelay: `${0.04 + delay * 0.05}s`, opacity: 0 }}>

      {/* Plan thumbnail */}
      <div className="h-44 bg-stone-50 overflow-hidden relative border-b border-stone-100">
        <img src={project.planImageUrl} alt={project.name}
          className="w-full h-full object-contain p-3 group-hover:scale-[1.03] transition-transform duration-500"
          style={{ imageRendering: "crisp-edges" }} />

        {/* Moodboard strip — if any exist */}
        {project.moodboards && project.moodboards.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 flex h-10 overflow-hidden">
            {project.moodboards.slice(0, 3).map((mb) => (
              <div key={mb.roomName} className="flex-1 overflow-hidden">
                <img src={mb.imageUrl} alt={mb.roomName}
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-sm font-medium text-stone-900 group-hover:text-stone-700 transition-colors leading-snug">
            {project.name}
          </h3>
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[project.status]}`} />
            <span className="font-mono text-[9px] tracking-widest uppercase text-stone-400">
              {STATUS_LABEL[project.status]}
            </span>
          </div>
        </div>

        <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wide mb-2">
          {project.clientName}
        </p>

        {/* Plot tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.map((tag) => (
              <span key={tag}
                className="px-1.5 py-0.5 bg-stone-100 rounded-sm font-mono text-[9px] text-stone-500 uppercase tracking-wider">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-1">
          <p className="font-mono text-[10px] text-stone-300">
            {new Date(project.createdAt).toLocaleDateString("en-GB", {
              day: "numeric", month: "short", year: "numeric",
            })}
          </p>
          <span className="font-mono text-[9px] text-stone-400 group-hover:text-stone-600 transition-colors">
            Continue →
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="fade-up fade-up-3 border border-dashed border-stone-200 rounded-sm py-20 text-center">
      <div className="w-12 h-12 border border-stone-200 rounded-sm flex items-center justify-center mx-auto mb-4">
        <svg className="w-5 h-5 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
      </div>
      <p className="font-mono text-xs tracking-widest text-stone-400 uppercase mb-3">No projects yet</p>
      <p className="text-stone-400 text-sm mb-6">Create your first project to get started.</p>
      <Link href="/project/new" className="btn-primary inline-flex">
        <span>+</span><span>New Project</span>
      </Link>
    </div>
  );
}
