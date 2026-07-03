/**
 * components/PlanCropEditor.tsx
 *
 * Plan snippet viewer + editor.
 *
 * DEFAULT STATE: shows the existing cropped snippet image (planSnippetUrl)
 * exactly as before — a static image with room name and size below it.
 * An "Adjust" button lets the user enter edit mode.
 *
 * EDIT MODE: replaces the snippet with an interactive viewport over the
 * full floor plan. The user can drag to pan and scroll to zoom. The
 * viewport starts at the AI-detected bounding box (or the current crop
 * region). "Save crop" sends the new viewport coordinates to the server,
 * which re-crops and updates the snippet. "Cancel" returns to the static
 * view without saving.
 */

"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface PlanCropEditorProps {
  planImageUrl: string;        // full floor plan URL
  snippetUrl?: string;         // existing cropped snippet URL (shown in default view)
  initialBox?: { x: number; y: number; width: number; height: number };
  roomName: string;
  roomSize?: string;
  onSave: (box: { x: number; y: number; width: number; height: number }) => void;
  saving?: boolean;
}

export function PlanCropEditor({
  planImageUrl,
  snippetUrl,
  initialBox,
  roomName,
  roomSize,
  onSave,
  saving,
}: PlanCropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing]   = useState(false);
  const [dragging, setDragging] = useState(false);

  // Viewport state: the normalised 0-1 region of the full plan visible in
  // the editor. Initialised from the AI bounding box (or full plan if none).
  const [vx, setVx] = useState(initialBox?.x ?? 0);
  const [vy, setVy] = useState(initialBox?.y ?? 0);
  const [vw, setVw] = useState(initialBox?.width ?? 1);
  const [vh, setVh] = useState(initialBox?.height ?? 1);

  const dragStart = useRef({ mx: 0, my: 0, vx: 0, vy: 0 });

  // Sync viewport if initialBox changes (e.g. after re-analysis)
  useEffect(() => {
    if (initialBox && !editing) {
      setVx(initialBox.x);
      setVy(initialBox.y);
      setVw(initialBox.width);
      setVh(initialBox.height);
    }
  }, [initialBox?.x, initialBox?.y, initialBox?.width, initialBox?.height]);

  const clamp = useCallback((x: number, y: number, w: number, h: number) => {
    const cw = Math.max(0.06, Math.min(1, w));
    const ch = Math.max(0.06, Math.min(1, h));
    return {
      x: Math.max(0, Math.min(1 - cw, x)),
      y: Math.max(0, Math.min(1 - ch, y)),
      w: cw,
      h: ch,
    };
  }, []);

  // ── Drag handlers ────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    if (!editing) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, vx, vy };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    // How far the pointer moved as a fraction of viewport size
    const dx = (e.clientX - dragStart.current.mx) / rect.width;
    const dy = (e.clientY - dragStart.current.my) / rect.height;
    // Dragging right → image moves left → viewport origin increases
    const clamped = clamp(dragStart.current.vx - dx * vw, dragStart.current.vy - dy * vh, vw, vh);
    setVx(clamped.x);
    setVy(clamped.y);
  }

  function onPointerUp() {
    setDragging(false);
  }

  // ── Zoom via native wheel listener (non-passive to allow preventDefault) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !editing) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();

      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      const newW = vw * zoomFactor;
      const newH = vh * zoomFactor;

      // Zoom toward the pointer position within the viewport
      const rect = el!.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;   // 0-1 within container
      const py = (e.clientY - rect.top)  / rect.height;

      // The pointer's position in normalised plan coords
      const planX = vx + px * vw;
      const planY = vy + py * vh;

      // Keep the plan point under the pointer after zoom
      const nx = planX - px * newW;
      const ny = planY - py * newH;

      const clamped = clamp(nx, ny, newW, newH);
      setVx(clamped.x);
      setVy(clamped.y);
      setVw(clamped.w);
      setVh(clamped.h);
    }

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [editing, vx, vy, vw, vh, clamp]);

  // ── Actions ──────────────────────────────────────────────────────────
  function handleSave() {
    onSave({ x: vx, y: vy, width: vw, height: vh });
    setEditing(false);
  }

  function handleReset() {
    if (initialBox) {
      setVx(initialBox.x); setVy(initialBox.y);
      setVw(initialBox.width); setVh(initialBox.height);
    } else {
      setVx(0); setVy(0); setVw(1); setVh(1);
    }
  }

  function handleCancel() {
    handleReset();
    setEditing(false);
  }

  // ── Rendering ────────────────────────────────────────────────────────

  // Editor view: CSS transform to show only the viewport region
  const scale = 1 / Math.max(vw, 0.01);
  const tx = -vx * scale * 100;
  const ty = -vy * scale * 100;

  // ──── DEFAULT (non-editing) VIEW: show the cropped snippet ────────────
  if (!editing) {
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">Plan</p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-mono text-[9px] text-stone-400 hover:text-stone-700 transition-colors flex items-center gap-1"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Adjust
          </button>
        </div>
        <div className="border border-stone-200 rounded-sm overflow-hidden bg-white">
          {snippetUrl ? (
            <img src={snippetUrl} alt={`${roomName} plan`}
              className="w-full object-contain" style={{ imageRendering: "crisp-edges", maxHeight: "160px" }} />
          ) : (
            <img src={planImageUrl} alt="Full floor plan"
              className="w-full object-contain" style={{ imageRendering: "crisp-edges", maxHeight: "160px" }} />
          )}
          <div className="px-2 py-1.5 border-t border-stone-100">
            <p className="font-mono text-[9px] text-stone-400 truncate">{roomName}</p>
            {roomSize && <p className="font-mono text-[9px] text-stone-300">{roomSize} m²</p>}
            {!snippetUrl && (
              <p className="font-mono text-[8px] text-stone-300 mt-0.5">Click Adjust to isolate this room</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ──── EDITING VIEW: interactive pan/zoom over full plan ──────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-mono text-[9px] text-amber-600 uppercase tracking-widest font-medium">Editing crop</p>
      </div>

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className={`border-2 border-amber-400 ring-2 ring-amber-100 rounded-sm overflow-hidden bg-white relative ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{ height: "200px", touchAction: "none" }}
      >
        <img
          src={planImageUrl}
          alt={`${roomName} plan — editing`}
          draggable={false}
          className="absolute top-0 left-0 pointer-events-none select-none"
          style={{
            imageRendering: "crisp-edges",
            width: `${scale * 100}%`,
            height: `${scale * 100}%`,
            transform: `translate(${tx}%, ${ty}%)`,
            transition: dragging ? "none" : "transform 0.1s ease-out",
          }}
        />

        {/* Hint — fades after first drag */}
        {!dragging && (
          <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
            <span className="bg-black/50 text-white font-mono text-[8px] px-2 py-1 rounded-sm uppercase tracking-wider backdrop-blur-sm">
              Drag to pan · Scroll to zoom
            </span>
          </div>
        )}

        {/* Zoom level indicator */}
        <div className="absolute top-2 right-2 pointer-events-none">
          <span className="bg-white/80 text-stone-500 font-mono text-[8px] px-1.5 py-0.5 rounded-sm backdrop-blur-sm">
            {Math.round(100 / Math.max(vw, vh))}%
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 mt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 font-mono text-[9px] uppercase tracking-widest bg-stone-900 text-white px-3 py-2 rounded-sm hover:bg-stone-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          {saving ? <><span className="spinner w-2.5 h-2.5" style={{ borderWidth: 1 }} /> Saving…</> : "Save crop"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="font-mono text-[9px] uppercase tracking-widest text-stone-400 px-3 py-2 border border-stone-200 rounded-sm hover:bg-stone-50 transition-colors"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          className="font-mono text-[9px] uppercase tracking-widest text-stone-400 px-3 py-2 hover:text-stone-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
