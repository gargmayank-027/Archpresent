"use client";

/**
 * NarrativePreview — shows the auto-generated walkthrough narrative
 * for each room, letting the architect edit before it goes into the PDF.
 *
 * Appears on the review page for concept presentations, between
 * the strengths card and the continue button.
 */

import { useState, useEffect } from "react";
import { buildRoomNarrative } from "@/lib/narrative";
import type { RoomDetail, PlotInfo } from "@/types";

interface Props {
  rooms: RoomDetail[];
  plotInfo?: PlotInfo;
  savedNarratives: Record<string, string>;
  onSave: (narratives: Record<string, string>) => Promise<void>;
}

export function NarrativePreview({ rooms, plotInfo, savedNarratives, onSave }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [narratives, setNarratives] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Initialize narratives from saved or auto-generated
  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const room of rooms) {
      initial[room.name] = savedNarratives[room.name] ?? buildRoomNarrative(room, plotInfo);
    }
    setNarratives(initial);
  }, [rooms, plotInfo, savedNarratives]);

  function updateNarrative(roomName: string, text: string) {
    setNarratives(prev => ({ ...prev, [roomName]: text }));
    setDirty(true);
  }

  function resetNarrative(roomName: string) {
    const room = rooms.find(r => r.name === roomName);
    if (room) {
      const auto = buildRoomNarrative(room, plotInfo);
      setNarratives(prev => ({ ...prev, [roomName]: auto }));
      setDirty(true);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(narratives);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">
            Walkthrough Narrative
          </span>
          {dirty && (
            <span className="text-[8px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-sm font-mono uppercase">
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-stone-400">{rooms.length} rooms</span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            className={`text-stone-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-stone-100 px-4 py-3 space-y-4">
          <p className="text-[11px] text-stone-400">
            This is what the client will read for each room in the presentation. Edit any narrative to personalise it.
          </p>

          {rooms.map((room) => {
            const n = room.name.toLowerCase();
            const icon = n.includes("bed") ? "🛏" : n.includes("kitchen") ? "🍳" :
              n.includes("living") || n.includes("drawing") ? "🛋" :
              n.includes("pooja") || n.includes("puja") ? "🕉" :
              n.includes("toilet") || n.includes("bath") ? "🚿" :
              n.includes("dining") ? "🍽" : n.includes("stair") ? "⬆" : "◻";

            return (
              <div key={room.name} className="group">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm opacity-60">{icon}</span>
                    <span className="text-xs font-medium text-stone-700">{room.name}</span>
                    {room.sizeEstimateSqm && (
                      <span className="font-mono text-[9px] text-stone-400">{room.sizeEstimateSqm} m²</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => resetNarrative(room.name)}
                    className="text-[9px] text-stone-400 hover:text-stone-600 font-mono uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Reset
                  </button>
                </div>
                <textarea
                  value={narratives[room.name] ?? ""}
                  onChange={(e) => updateNarrative(room.name, e.target.value)}
                  rows={2}
                  className="w-full text-xs text-stone-600 leading-relaxed border border-stone-100 rounded-sm px-3 py-2 resize-none focus:border-amber-300 focus:outline-none transition-colors bg-white"
                  placeholder="Write a short narrative for this room..."
                />
              </div>
            );
          })}

          {/* Save button */}
          <div className="flex items-center justify-between pt-2 border-t border-stone-100">
            <p className="text-[10px] text-stone-400">
              {dirty ? "You have unsaved changes." : "Narratives saved."}
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="btn-secondary text-xs disabled:opacity-30"
            >
              {saving ? "Saving…" : "Save narratives"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
