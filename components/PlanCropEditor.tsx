"use client";

/**
 * components/PlanCropEditor.tsx
 *
 * DEFAULT: cropped snippet image + "Adjust" button.
 * EDIT: full plan rendered via CSS background-image (no distortion),
 * user drags to pan, scrolls to zoom. Saves re-cropped snippet via API.
 *
 * State model: zoom (single scalar), panX/panY (normalised 0-1 center).
 * No independent vw/vh — zoom is uniform, aspect ratio is never broken.
 */

import { useRef, useState, useEffect, useCallback } from "react";

interface Box { x: number; y: number; width: number; height: number }

interface Props {
  planImageUrl: string;
  snippetUrl?: string;
  initialBox?: Box;
  roomName: string;
  roomSize?: string;
  onSave: (box: Box) => void;
  saving?: boolean;
}

export function PlanCropEditor({
  planImageUrl, snippetUrl, initialBox, roomName, roomSize, onSave, saving,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [imgNat, setImgNat] = useState<{ w: number; h: number } | null>(null);
  const [cW, setCW] = useState(200);
  const [cH, setCH] = useState(200);
  const waitingForSave = useRef(false);

  // State: zoom (1 = full width visible, 2 = half visible, etc.)
  // panX/panY: normalised center of visible region (0-1 in image coords)
  const initZoom = initialBox ? 1 / initialBox.width : 1;
  const initPanX = initialBox ? initialBox.x + initialBox.width / 2 : 0.5;
  const initPanY = initialBox ? initialBox.y + initialBox.height / 2 : 0.5;

  const [zoom, setZoom] = useState(initZoom);
  const [panX, setPanX] = useState(initPanX);
  const [panY, setPanY] = useState(initPanY);

  const drag = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // Load image natural size
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = planImageUrl;
  }, [planImageUrl]);

  // Measure container
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = () => { setCW(el.clientWidth); setCH(el.clientHeight); };
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);

  // Snap to initialBox when entering edit mode
  useEffect(() => {
    if (editing) {
      const z = initialBox ? 1 / initialBox.width : 1;
      const px = initialBox ? initialBox.x + initialBox.width / 2 : 0.5;
      const py = initialBox ? initialBox.y + initialBox.height / 2 : 0.5;
      setZoom(z); setPanX(px); setPanY(py);
    }
  }, [editing]);

  // Exit edit mode when save completes (snippetUrl changes)
  useEffect(() => {
    if (waitingForSave.current && !saving) {
      waitingForSave.current = false;
      setEditing(false);
    }
  }, [saving, snippetUrl]);

  // ── Derived: background-image rendering (pixel-based, no distortion) ──
  const getRendering = useCallback(() => {
    if (!imgNat) return { bgSize: "contain", bgPos: "center" };
    // At current zoom, the image width in pixels:
    const imgW = cW * zoom;
    const imgH = imgW * (imgNat.h / imgNat.w); // aspect ratio preserved
    // The center of the viewport (panX, panY) maps to the center of the container
    const bgX = cW / 2 - panX * imgW;
    const bgY = cH / 2 - panY * imgH;
    return {
      bgSize: `${imgW}px ${imgH}px`,
      bgPos: `${bgX}px ${bgY}px`,
    };
  }, [imgNat, cW, cH, zoom, panX, panY]);

  // ── Clamp pan so image edges don't pull away from container ──
  const clampPan = useCallback((px: number, py: number, z: number) => {
    if (!imgNat) return { px, py };
    const halfVisW = 1 / z / 2; // half of visible width in normalised coords
    const imgH = cW * z * (imgNat.h / imgNat.w);
    const halfVisH = (cH / imgH) / 2;
    return {
      px: Math.max(halfVisW, Math.min(1 - halfVisW, px)),
      py: Math.max(halfVisH, Math.min(1 - halfVisH, py)),
    };
  }, [imgNat, cW, cH]);

  // ── To bounding box for saving ──
  function toBox(): Box {
    const w = 1 / zoom;
    const h = imgNat ? (cH / (cW * zoom * (imgNat.h / imgNat.w))) : w;
    const x = panX - w / 2;
    const y = panY - h / 2;
    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.min(1, w),
      height: Math.min(1, h),
    };
  }

  // ── Drag ──
  function onPointerDown(e: React.PointerEvent) {
    if (!editing) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    drag.current = { mx: e.clientX, my: e.clientY, px: panX, py: panY };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || !imgNat) return;
    const imgW = cW * zoom;
    const imgH = imgW * (imgNat.h / imgNat.w);
    const dx = (e.clientX - drag.current.mx) / imgW;
    const dy = (e.clientY - drag.current.my) / imgH;
    const c = clampPan(drag.current.px - dx, drag.current.py - dy, zoom);
    setPanX(c.px); setPanY(c.py);
  }
  function onPointerUp() { setDragging(false); }

  // ── Zoom (native non-passive wheel) ──
  useEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY > 0 ? 0.88 : 1.15;
      const newZoom = Math.max(1, Math.min(20, zoom * factor));
      // Zoom toward pointer position
      const rect = el!.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;
      // The point under the pointer in normalised image coords:
      const visW = 1 / zoom;
      const imgH_px = cW * zoom * (imgNat ? imgNat.h / imgNat.w : 1);
      const visH = cH / imgH_px;
      const ptX = panX + (mx - 0.5) * visW;
      const ptY = panY + (my - 0.5) * visH;
      // After zoom, keep that point under the pointer
      const newVisW = 1 / newZoom;
      const newImgH = cW * newZoom * (imgNat ? imgNat.h / imgNat.w : 1);
      const newVisH = cH / newImgH;
      const newPx = ptX - (mx - 0.5) * newVisW;
      const newPy = ptY - (my - 0.5) * newVisH;
      const c = clampPan(newPx, newPy, newZoom);
      setZoom(newZoom); setPanX(c.px); setPanY(c.py);
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [editing, zoom, panX, panY, imgNat, cW, cH, clampPan]);

  // ── Actions ──
  function handleSave() {
    waitingForSave.current = true;
    onSave(toBox());
  }
  function handleReset() {
    const z = initialBox ? 1 / initialBox.width : 1;
    const px = initialBox ? initialBox.x + initialBox.width / 2 : 0.5;
    const py = initialBox ? initialBox.y + initialBox.height / 2 : 0.5;
    setZoom(z); setPanX(px); setPanY(py);
  }

  // ── DEFAULT VIEW ──
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
            {!snippetUrl && <p className="font-mono text-[8px] text-stone-300 mt-0.5">Click Adjust to isolate</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── EDIT VIEW ──
  const { bgSize, bgPos } = getRendering();

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-mono text-[9px] text-amber-600 uppercase tracking-widest font-medium">Editing crop</p>
        <span className="font-mono text-[8px] text-stone-400">{Math.round(zoom * 100)}%</span>
      </div>

      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className={`border-2 border-amber-400 ring-2 ring-amber-100 rounded-sm overflow-hidden relative select-none ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          height: "200px",
          touchAction: "none",
          backgroundImage: `url(${planImageUrl})`,
          backgroundSize: bgSize,
          backgroundPosition: bgPos,
          backgroundRepeat: "no-repeat",
          backgroundColor: "#fafaf8",
          imageRendering: "crisp-edges",
          transition: dragging ? "none" : "background-size 0.15s ease-out, background-position 0.15s ease-out",
        }}
      >
        {!dragging && (
          <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
            <span className="bg-black/50 text-white font-mono text-[8px] px-2.5 py-1 rounded-sm uppercase tracking-wider backdrop-blur-sm">
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
        <button type="button" onClick={() => { handleReset(); setEditing(false); }} disabled={saving}
          className="font-mono text-[9px] uppercase tracking-widest text-stone-400 px-3 py-2 hover:text-stone-600 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
