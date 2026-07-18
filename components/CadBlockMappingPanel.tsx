"use client";

/**
 * components/CadBlockMappingPanel.tsx
 *
 * Shown on the CAD review page when a render reports `unmappedBlockNames`
 * — CAD block names (e.g. "RGHRHT", "A$C0D2919B9") that didn't match any
 * known furniture pattern (renderer_service/app/services/block_mapper.py)
 * and rendered as the generic placeholder symbol. Lets the architect
 * assign each one to a real furniture category; "Apply" re-renders with
 * those mappings sent as `blockOverrides`, which the backend merges into
 * (not replaces) whatever was already mapped for this project, so
 * choices accumulate across re-renders rather than needing to be redone
 * every time.
 */

import { useState } from "react";

// Mirrors renderer_service/app/models/floorplan.py's FurnitureCategory
// enum exactly — keep in sync if that enum changes.
const FURNITURE_CATEGORIES: { value: string; label: string }[] = [
  { value: "bed", label: "Bed (single)" },
  { value: "queen_bed", label: "Bed (queen)" },
  { value: "king_bed", label: "Bed (king)" },
  { value: "sofa", label: "Sofa" },
  { value: "armchair", label: "Armchair" },
  { value: "dining_table", label: "Dining table" },
  { value: "dining_chair", label: "Dining chair" },
  { value: "coffee_table", label: "Coffee table" },
  { value: "tv_unit", label: "TV unit" },
  { value: "wardrobe", label: "Wardrobe" },
  { value: "desk", label: "Desk" },
  { value: "kitchen_counter", label: "Kitchen counter" },
  { value: "sink", label: "Sink" },
  { value: "wc", label: "WC / toilet" },
  { value: "bathtub", label: "Bathtub" },
];

interface Props {
  unmappedBlockNames: string[];
  existingOverrides: Record<string, string>;
  onApply: (overrides: Record<string, string>) => Promise<void>;
  applying?: boolean;
}

export function CadBlockMappingPanel({ unmappedBlockNames, existingOverrides, onApply, applying }: Props) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  if (unmappedBlockNames.length === 0) return null;

  const readyCount = unmappedBlockNames.filter((name) => selections[name]).length;

  async function handleApply() {
    const overrides: Record<string, string> = {};
    for (const [name, category] of Object.entries(selections)) {
      if (category) overrides[name] = category;
    }
    if (Object.keys(overrides).length === 0) return;
    await onApply(overrides);
    setSelections({});
  }

  return (
    <div className="card p-4 bg-white space-y-3">
      <div>
        <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase mb-1">
          Unrecognized furniture ({unmappedBlockNames.length})
        </p>
        <p className="text-xs text-stone-500 leading-relaxed">
          These blocks from your CAD file don&apos;t match a known furniture type and are shown
          with a placeholder symbol. Map any you recognize — this is remembered for future
          re-renders of this project.
        </p>
      </div>

      <div className="space-y-2">
        {unmappedBlockNames.map((name) => (
          <div key={name} className="flex items-center gap-2">
            <code className="font-mono text-[10px] text-stone-500 bg-stone-50 px-1.5 py-1 rounded-sm flex-1 truncate"
                  title={name}>
              {name}
            </code>
            <select
              value={selections[name] ?? existingOverrides[name] ?? ""}
              onChange={(e) => setSelections((s) => ({ ...s, [name]: e.target.value }))}
              className="text-xs border border-stone-200 rounded-sm px-2 py-1 bg-white text-stone-700 w-40 flex-shrink-0"
            >
              <option value="">Leave as generic</option>
              {FURNITURE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleApply}
        disabled={readyCount === 0 || applying}
        className="w-full btn-secondary py-2 text-xs disabled:opacity-40"
      >
        {applying ? "Applying…" : readyCount > 0 ? `Apply ${readyCount} mapping${readyCount === 1 ? "" : "s"} & re-render` : "Select at least one to apply"}
      </button>
    </div>
  );
}
