"use client";

/**
 * components/CadThemePicker.tsx
 *
 * Lets the architect pick one of the CAD renderer's plan themes
 * (Modern/Luxury/Scandinavian/...). This is the *plan's* own theme —
 * kept visually and structurally distinct from `presentationTheme`
 * (Classic/Dark/Minimal/Warm), which styles the PDF/share deck. Mirrors
 * design-system.md §2's rule that these two theming axes must never be
 * conflated. Visual language matches components/ThemeToggle.tsx and
 * components/StepIndicator.tsx (existing pill/segmented-control patterns)
 * rather than introducing a new UI idiom.
 */

import { useEffect, useState } from "react";

interface CadTheme {
  key: string;
  name: string;
  description: string;
  available: boolean;
}

interface Props {
  value: string;
  onChange: (themeKey: string) => void;
  disabled?: boolean;
}

export function CadThemePicker({ value, onChange, disabled }: Props) {
  const [themes, setThemes] = useState<CadTheme[]>([]);

  useEffect(() => {
    fetch("/api/cad/themes")
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => setThemes([]));
  }, []);

  if (themes.length === 0) return null;

  return (
    <div>
      <p className="font-mono text-[10px] tracking-widest text-stone-400 uppercase mb-2">Plan theme</p>
      <div className="grid grid-cols-3 gap-2">
        {themes.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={disabled || !t.available}
            onClick={() => onChange(t.key)}
            title={t.available ? t.description : `${t.name} — coming soon`}
            className={`px-3 py-2 rounded-sm border text-left transition-colors ${
              value === t.key
                ? "border-stone-900 bg-stone-900 text-white"
                : t.available
                ? "border-stone-200 text-stone-600 hover:border-stone-400"
                : "border-stone-100 text-stone-300 cursor-not-allowed"
            }`}
          >
            <span className="block font-mono text-[10px] uppercase tracking-widest">{t.name}</span>
            {!t.available && (
              <span className="block text-[9px] mt-0.5 opacity-70">Coming soon</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
