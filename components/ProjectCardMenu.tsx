"use client";

/**
 * components/ProjectCardMenu.tsx
 *
 * Three-dot options menu shown on each project card.
 * Options: Edit, Share, Delete.
 *
 *  - Edit   → navigates to the review step to continue editing the project
 *  - Share  → generates a share link (if not already active) and copies it
 *  - Delete → confirms, then calls DELETE /api/projects/[id] and removes
 *             the card from the parent list via onDeleted callback
 */

import { useEffect, useRef, useState } from "react";
import type { Project } from "@/types";

interface ProjectCardMenuProps {
  project: Project;
  onDeleted: (id: string) => void;
}

export function ProjectCardMenu({ project, onDeleted }: ProjectCardMenuProps) {
  const [open,        setOpen]        = useState(false);
  const [confirming,  setConfirming]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [sharing,     setSharing]     = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Reset confirm state when menu closes
  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  function toggleMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen((o) => !o);
  }

  function handleEdit(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    window.location.href = `/project/${project.id}/review`;
  }

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSharing(true);
    try {
      // If a link already exists and is enabled, just copy it
      if (project.shareToken && project.shareEnabled) {
        const url = `${window.location.origin}/share/${project.shareToken}`;
        await navigator.clipboard.writeText(url);
      } else {
        // Generate a new share link
        const res = await fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, expiresIn: "never" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to generate link");
        await navigator.clipboard.writeText(data.shareUrl);
      }
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch (err) {
      console.error("Share failed:", err);
      alert(err instanceof Error ? err.message : "Failed to generate share link");
    } finally {
      setSharing(false);
      setOpen(false);
    }
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(true);
  }

  async function handleDeleteConfirm(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete project");
      }
      onDeleted(project.id);
    } catch (err) {
      console.error("Delete failed:", err);
      alert(err instanceof Error ? err.message : "Failed to delete project");
      setDeleting(false);
      setConfirming(false);
    }
  }

  function handleDeleteCancel(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  }

  return (
    <div ref={menuRef} className="relative" onClick={(e) => e.stopPropagation()}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={toggleMenu}
        className={`w-8 h-8 flex items-center justify-center rounded-sm border transition-all ${
          open
            ? "bg-stone-200 text-stone-700 border-stone-300"
            : "bg-white text-stone-400 border-stone-200 hover:bg-stone-100 hover:text-stone-600 hover:border-stone-300 shadow-sm"
        }`}
        aria-label="Project options"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="3" r="1.4" fill="currentColor" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          <circle cx="8" cy="13" r="1.4" fill="currentColor" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-9 z-30 w-44 bg-white border border-stone-200 rounded-sm overflow-hidden fade-up fade-up-1"
          style={{ boxShadow: "0 4px 16px rgba(26,25,23,0.10), 0 2px 4px rgba(26,25,23,0.06)" }}>
          {!confirming ? (
            <>
              {/* Edit */}
              <button
                type="button"
                onClick={handleEdit}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-stone-50 transition-colors"
              >
                <EditIcon />
                <span className="text-xs text-stone-700">Edit</span>
              </button>

              {/* Share */}
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-stone-50 transition-colors disabled:opacity-50"
              >
                {sharing ? (
                  <span className="spinner w-3.5 h-3.5" style={{ borderWidth: 1.5 }} />
                ) : shareCopied ? (
                  <CheckIcon />
                ) : (
                  <ShareIcon />
                )}
                <span className="text-xs text-stone-700">
                  {shareCopied ? "Link copied!" : sharing ? "Generating…" : "Share"}
                </span>
              </button>

              {/* Duplicate */}
              <button
                type="button"
                onClick={async (e) => {
                  e.preventDefault(); e.stopPropagation();
                  setDuplicating(true);
                  try {
                    const res = await fetch("/api/projects/duplicate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ projectId: project.id }),
                    });
                    if (res.ok) window.location.reload();
                  } catch {} finally { setDuplicating(false); }
                }}
                disabled={duplicating}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-stone-50 transition-colors disabled:opacity-50"
              >
                {duplicating ? (
                  <span className="spinner w-3.5 h-3.5" style={{ borderWidth: 1.5 }} />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                )}
                <span className="text-xs text-stone-700">
                  {duplicating ? "Duplicating…" : "Duplicate"}
                </span>
              </button>

              {/* Divider */}
              <div className="h-px bg-stone-100" />

              {/* Delete */}
              <button
                type="button"
                onClick={handleDeleteClick}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-red-50 transition-colors group"
              >
                <DeleteIcon />
                <span className="text-xs text-stone-700 group-hover:text-red-600">Delete</span>
              </button>
            </>
          ) : (
            /* Delete confirmation */
            <div className="p-3 space-y-2.5">
              <p className="text-xs text-stone-600 leading-relaxed">
                Delete <strong className="text-stone-800">{project.name}</strong>? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDeleteCancel}
                  disabled={deleting}
                  className="flex-1 font-mono text-[10px] uppercase tracking-widest text-stone-500 border border-stone-200 rounded-sm py-1.5 hover:bg-stone-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  className="flex-1 font-mono text-[10px] uppercase tracking-widest text-white bg-red-500 hover:bg-red-600 rounded-sm py-1.5 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {deleting ? (
                    <><span className="spinner w-2.5 h-2.5" style={{ borderWidth: 1.5 }} /><span>...</span></>
                  ) : (
                    "Delete"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function EditIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-stone-400 group-hover:text-red-500 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
