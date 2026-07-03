/**
 * components/PlanCropEditor.tsx
 *
 * Interactive plan-snippet editor. Shows the full floor plan inside a
 * small viewport that the user can drag to pan and scroll to zoom.
 * When they release, the visible region becomes the room's plan snippet.
 *
 * The viewport position is described as a normalised bounding box (0-1)
 * relative to the full plan image — same format as RoomBoundingBox — so
 * it plugs directly into the existing crop pipeline.
 */

"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface PlanCropEditorProps {
  planImageUrl: string;      // full floor plan URL
  initialBox?: { x: number; y: number; width: number; height: number };
  roomName: string;
  roomSize?: string;
  onSave: (box: { x: number; y: number; width: number; height: number }) => void;
  saving?: boolean;
}

export function PlanCropEditor({
  planImageUrl,
  initialBox,
  roomName,
  roomSize,
  onSave,
  saving,
}: PlanCropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing]   = useState(false);
  const [dragging, setDragging] = useState(false);
  const [imgSize, setImgSize]   = useState({ w: 1, h: 1 }); // natural image dimensions

  // Viewport state: what portion of the plan is visible (normalised 0-1)
  const [vx, setVx] = useState(initialBox?.x ?? 0);
  const [vy, setVy] = useState(initialBox?.y ?? 0);
  const [vw, setVw] = useState(initialBox?.width ?? 1);
  const [vh, setVh] = useState(initialBox?.height ?? 1);

  // Drag tracking
  const dragStart = useRef({ mx: 0, my: 0, vx: 0, vy: 0 });

  // Load image natural dimensions once
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = planImageUrl;
  }, [planImageUrl]);

  // Clamp viewport
  const clamp = useCallback((x: number, y: number, w: number, h: number) => {
    const cw = Math.max(0.08, Math.min(1, w));
    const ch = Math.max(0.08, Math.min(1, h));
    return {
      x: Math.max(0, Math.min(1 - cw, x)),
      y: Math.max(0, Math.min(1 - ch, y)),
      w: cw,
      h: ch,
    };
  }, []);

  // Pointer events for dragging
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
    const dx = (e.clientX - dragStart.current.mx) / rect.width;
    const dy = (e.clientY - dragStart.current.my) / rect.height;

    // We're panning the image behind the viewport, so movement is inverted
    const clamped = clamp(dragStart.current.vx - dx * vw, dragStart.current.vy - dy * vh, vw, vh);
    setVx(clamped.x);
    setVy(clamped.y);
  }

  function onPointerUp() {
    setDragging(false);
  }

  // Scroll to zoom
  function onWheel(e: React.WheelEvent) {
    if (!editing) return;
    e.stopPropagation();
    const zoomFactor = e.deltaY > 0 ? 1.12 : 0.88;

    const newW = vw * zoomFactor;
    const newH = vh * zoomFactor;

    // Zoom toward center of current viewport
    const cx = vx + vw / 2;
    const cy = vy + vh / 2;
    const clamped = clamp(cx - newW / 2, cy - newH / 2, newW, newH);
    setVx(clamped.x);
    setVy(clamped.y);
    setVw(clamped.w);
    setVh(clamped.h);
  }

  function handleSave() {
    onSave({ x: vx, y: vy, width: vw, height: vh });
    setEditing(false);
  }

  function handleReset() {
    if (initialBox) {
      setVx(initialBox.x);
      setVy(initialBox.y);
      setVw(initialBox.width);
      setVh(initialBox.height);
    } else {
      setVx(0); setVy(0); setVw(1); setVh(1);
    }
  }

  // CSS: translate/scale the full plan image so only the viewport region is visible
  const scale = 1 / Math.max(vw, 0.01);
  const tx = -vx * scale * 100;
  const ty = -vy * scale * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">Plan</p>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-mono text-[9px] text-stone-400 hover:text-stone-700 transition-colors"
          >
            Adjust ↗
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        className={`border rounded-sm overflow-hidden bg-white relative ${
          editing
            ? "border-amber-400 ring-2 ring-amber-100 cursor-grab"
            : "border-stone-200"
        } ${dragging ? "cursor-grabbing" : ""}`}
        style={{ height: "160px", touchAction: editing ? "none" : "auto" }}
      >
        <img
          src={planImageUrl}
          alt={`${roomName} plan`}
          draggable={false}
          className="absolute top-0 left-0 pointer-events-none select-none"
          style={{
            imageRendering: "crisp-edges",
            width: `${scale * 100}%`,
            height: `${scale * 100}%`,
            transform: `translate(${tx}%, ${ty}%)`,
            objectFit: "contain",
            transition: dragging ? "none" : "transform 0.15s ease",
          }}
        />

        {/* Edit mode hint overlay */}
        {editing && !dragging && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="bg-black/50 text-white font-mono text-[9px] px-2 py-1 rounded-sm uppercase tracking-wider">
              Drag to pan · Scroll to zoom
            </span>
          </div>
        )}
      </div>

      {/* Room info footer */}
      <div className="px-2 py-1.5 border-x border-b border-stone-200 rounded-b-sm bg-white">
        <p className="font-mono text-[9px] text-stone-400 truncate">{roomName}</p>
        {roomSize && <p className="font-mono text-[9px] text-stone-300">{roomSize} m²</p>}
      </div>

      {/* Edit mode actions */}
      {editing && (
        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 font-mono text-[9px] uppercase tracking-widest bg-stone-900 text-white px-3 py-1.5 rounded-sm hover:bg-stone-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {saving ? <><span className="spinner w-2.5 h-2.5" style={{ borderWidth: 1 }} /> Saving…</> : "Save crop"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            className="font-mono text-[9px] uppercase tracking-widest text-stone-400 px-3 py-1.5 border border-stone-200 rounded-sm hover:bg-stone-50 transition-colors"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => { handleReset(); setEditing(false); }}
            disabled={saving}
            className="font-mono text-[9px] uppercase tracking-widest text-stone-400 px-3 py-1.5 hover:text-stone-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
