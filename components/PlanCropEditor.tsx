/**
 * components/PlanCropEditor.tsx
 *
 * DEFAULT: shows the existing cropped snippet image with an "Adjust" button.
 * EDIT MODE: shows the full plan, zoomed+panned to the current crop region,
 * with drag-to-pan and scroll-to-zoom. Saves the new crop via API.
 *
 * Key fixes vs previous version:
 *  - No distortion: image dimensions are calculated from natural aspect
 *    ratio + container measurements, never stretched independently.
 *  - Starts from current crop position, not zoomed-out full plan.
 *  - Stays in edit mode until the new snippet is confirmed by the parent.
 */

"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface Box { x: number; y: number; width: number; height: number }

interface PlanCropEditorProps {
  planImageUrl: string;
  snippetUrl?: string;
  initialBox?: Box;
  roomName: string;
  roomSize?: string;
  onSave: (box: Box) => void;
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
  const [editing, setEditing]     = useState(false);
  const [dragging, setDragging]   = useState(false);
  const [imgNat, setImgNat]       = useState<{ w: number; h: number } | null>(null);
  const [cSize, setCSize]         = useState({ w: 200, h: 200 });
  const [saved, setSaved]         = useState(false); // true after save completes

  // Viewport: normalised 0-1 region of the plan visible in the editor
  const [vx, setVx] = useState(initialBox?.x ?? 0);
  const [vy, setVy] = useState(initialBox?.y ?? 0);
  const [vw, setVw] = useState(initialBox?.width ?? 1);
  const [vh, setVh] = useState(initialBox?.height ?? 1);

  const dragStart = useRef({ mx: 0, my: 0, vx: 0, vy: 0 });

  // Load natural image dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = planImageUrl;
  }, [planImageUrl]);

  // Measure container on mount + resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setCSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);

  // When entering edit mode, snap viewport to current box
  useEffect(() => {
    if (editing && initialBox) {
      setVx(initialBox.x);
      setVy(initialBox.y);
      setVw(initialBox.width);
      setVh(initialBox.height);
    }
  }, [editing]);

  // When saving finishes and we have a new snippet, exit edit mode
  const prevSaving = useRef(saving);
  useEffect(() => {
    if (prevSaving.current && !saving && saved) {
      setEditing(false);
      setSaved(false);
    }
    prevSaving.current = saving;
  }, [saving, saved]);

  // Sync if initialBox changes externally (e.g. re-analysis) while not editing
  useEffect(() => {
    if (!editing && initialBox) {
      setVx(initialBox.x);
      setVy(initialBox.y);
      setVw(initialBox.width);
      setVh(initialBox.height);
    }
  }, [initialBox?.x, initialBox?.y, initialBox?.width, initialBox?.height]);

  const clamp = useCallback((x: number, y: number, w: number, h: number) => {
    const cw = Math.max(0.05, Math.min(1, w));
    const ch = Math.max(0.05, Math.min(1, h));
    return {
      x: Math.max(0, Math.min(1 - cw, x)),
      y: Math.max(0, Math.min(1 - ch, y)),
      w: cw, h: ch,
    };
  }, []);

  // ── Drag ──────────────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    if (!editing) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, vx, vy };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || !imgNat) return;
    const { w: dispW, h: dispH } = getDisplayDims();
    const dx = (e.clientX - dragStart.current.mx) / dispW;
    const dy = (e.clientY - dragStart.current.my) / dispH;
    const c = clamp(dragStart.current.vx - dx * vw, dragStart.current.vy - dy * vh, vw, vh);
    setVx(c.x); setVy(c.y);
  }
  function onPointerUp() { setDragging(false); }

  // ── Zoom (native non-passive wheel) ───────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !editing) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY > 0 ? 1.12 : 0.89;
      const nw = vw * factor, nh = vh * factor;
      const rect = el!.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const planX = vx + px * vw, planY = vy + py * vh;
      const c = clamp(planX - px * nw, planY - py * nh, nw, nh);
      setVx(c.x); setVy(c.y); setVw(c.w); setVh(c.h);
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [editing, vx, vy, vw, vh, clamp]);

  // ── Pixel-accurate image placement (no distortion) ────────────────────
  function getDisplayDims() {
    if (!imgNat) return { w: cSize.w, h: cSize.h };
    const fitScale = Math.min(cSize.w / imgNat.w, cSize.h / imgNat.h);
    return { w: imgNat.w * fitScale, h: imgNat.h * fitScale };
  }

  function getImgStyle(): React.CSSProperties {
    if (!imgNat) return { width: "100%", height: "100%", objectFit: "contain" as const };
    const { w: fitW, h: fitH } = getDisplayDims();
    const zoom = 1 / vw;
    const dispW = fitW * zoom;
    const dispH = fitH * zoom;
    const left = -vx * dispW + Math.max(0, (cSize.w - dispW) / 2);
    const top  = -vy * dispH + Math.max(0, (cSize.h - dispH) / 2);
    return {
      position: "absolute" as const,
      width: dispW, height: dispH,
      left, top,
      imageRendering: "crisp-edges" as const,
      pointerEvents: "none" as const,
      userSelect: "none" as const,
      transition: dragging ? "none" : "left 0.1s ease-out, top 0.1s ease-out, width 0.1s ease-out, height 0.1s ease-out",
    };
  }

  // ── Actions ────────────────────────────────────────────────────────────
  function handleSave() {
    setSaved(true);
    onSave({ x: vx, y: vy, width: vw, height: vh });
    // Don't setEditing(false) — wait for saving to complete (parent updates snippetUrl)
  }
  function handleReset() {
    if (initialBox) { setVx(initialBox.x); setVy(initialBox.y); setVw(initialBox.width); setVh(initialBox.height); }
    else { setVx(0); setVy(0); setVw(1); setVh(1); }
  }
  function handleCancel() { handleReset(); setEditing(false); }

  // ── DEFAULT VIEW ──────────────────────────────────────────────────────
  if (!editing) {
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">Plan</p>
          <button type="button" onClick={() => setEditing(true)}
            className="font-mono text-[9px] text-stone-400 hover:text-stone-700 transition-colors flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Adjust
          </button>
        </div>
        <div className="border border-stone-200 rounded-sm overflow-hidden bg-white">
          <img src={snippetUrl || planImageUrl} alt={`${roomName} plan`}
            className="w-full object-contain" style={{ imageRendering: "crisp-edges", maxHeight: "160px" }} />
          <div className="px-2 py-1.5 border-t border-stone-100">
            <p className="font-mono text-[9px] text-stone-400 truncate">{roomName}</p>
            {roomSize && <p className="font-mono text-[9px] text-stone-300">{roomSize} m²</p>}
            {!snippetUrl && <p className="font-mono text-[8px] text-stone-300 mt-0.5">Click Adjust to isolate this room</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── EDIT VIEW ─────────────────────────────────────────────────────────
  const zoomPct = Math.round(100 / vw);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-mono text-[9px] text-amber-600 uppercase tracking-widest font-medium">Editing crop</p>
        <span className="font-mono text-[8px] text-stone-400">{zoomPct}%</span>
      </div>

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className={`border-2 border-amber-400 ring-2 ring-amber-100 rounded-sm overflow-hidden bg-stone-50 relative ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{ height: "200px", touchAction: "none" }}
      >
        <img src={planImageUrl} alt={`${roomName} plan — editing`} draggable={false} style={getImgStyle()} />

        {!dragging && (
          <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
            <span className="bg-black/50 text-white font-mono text-[8px] px-2 py-1 rounded-sm uppercase tracking-wider backdrop-blur-sm">
              Drag to pan · Scroll to zoom
            </span>
          </div>
        )}
      </div>

      <div className="flex gap-1.5 mt-2">
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-1 font-mono text-[9px] uppercase tracking-widest bg-stone-900 text-white px-3 py-2 rounded-sm hover:bg-stone-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
          {saving ? <><span className="spinner w-2.5 h-2.5" style={{ borderWidth: 1 }} /> Saving…</> : "Save crop"}
        </button>
        <button type="button" onClick={handleReset} disabled={saving}
          className="font-mono text-[9px] uppercase tracking-widest text-stone-400 px-3 py-2 border border-stone-200 rounded-sm hover:bg-stone-50 transition-colors">
          Reset
        </button>
        <button type="button" onClick={handleCancel} disabled={saving}
          className="font-mono text-[9px] uppercase tracking-widest text-stone-400 px-3 py-2 hover:text-stone-600 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
