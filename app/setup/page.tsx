"use client";

import { useEffect, useState } from "react";

interface ProviderStatus {
  gemini:    "ok" | "missing";
  hf:        "ok" | "missing";
  anthropic: "ok" | "missing";
  openai:    "ok" | "missing";
  replicate: "ok" | "missing";
}

export default function SetupPage() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);

  useEffect(() => {
    fetch("/api/setup-status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-10 fade-up fade-up-1">
        <p className="font-mono text-xs tracking-widest text-stone-400 uppercase mb-4">
          Free AI Setup Guide
        </p>
        <h1 className="font-display text-4xl font-light text-stone-900 mb-3"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          Two free keys,<br />full AI features.
        </h1>
        <p className="text-stone-500 text-sm leading-relaxed">
          ArchPresent uses two free AI APIs. Setup takes about 3 minutes.
          No credit card required for either.
        </p>
      </div>

      {/* Status indicators */}
      {status && (
        <div className="card p-5 mb-8 space-y-3 fade-up fade-up-2">
          <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Current Status</p>
          <div className="grid grid-cols-2 gap-2">
            <StatusRow label="Gemini Flash (analysis)" ok={status.gemini === "ok"} free />
            <StatusRow label="Hugging Face (images)"   ok={status.hf === "ok"}      free />
            <StatusRow label="Claude (analysis)"       ok={status.anthropic === "ok"} />
            <StatusRow label="GPT-4o (analysis)"       ok={status.openai === "ok"} />
            <StatusRow label="Replicate (images)"      ok={status.replicate === "ok"} />
          </div>
        </div>
      )}

      {/* Step 1 — Gemini */}
      <SetupStep
        num="01"
        title="Google Gemini Flash — Plan Analysis"
        badge="Free · 1,500 req/day"
        badgeColor="bg-green-100 text-green-700"
        steps={[
          { label: "Go to", link: { text: "aistudio.google.com", url: "https://aistudio.google.com" } },
          { label: 'Click "Get API Key" → "Create API key"' },
          { label: "Copy the key (starts with AIza…)" },
          { label: 'Add to your .env.local file:', code: "GOOGLE_AI_KEY=AIzaSy..." },
          { label: "Restart the dev server: npm run dev" },
        ]}
        what="Analyses your floor plan image — identifies all rooms, estimates sizes, detects orientation and natural light, finds special features like attached bathrooms and island counters."
      />

      {/* Step 2 — Hugging Face */}
      <SetupStep
        num="02"
        title="Hugging Face — Interior Moodboards"
        badge="Free · generous limits"
        badgeColor="bg-green-100 text-green-700"
        steps={[
          { label: "Go to", link: { text: "huggingface.co", url: "https://huggingface.co/join" } },
          { label: "Create a free account" },
          { label: "Go to Settings → Access Tokens → New token" },
          { label: 'Name it "archpresent", set role to "read"' },
          { label: "Copy the token (starts with hf_…)" },
          { label: 'Add to your .env.local file:', code: "HF_TOKEN=hf_..." },
          { label: "Restart the dev server: npm run dev" },
        ]}
        what="Generates photorealistic interior moodboard images using FLUX.1-schnell. Each image is specific to the room size, orientation, natural light, and your style choices."
        note="First image may take 20–40 seconds while the AI model loads. Subsequent images are faster. This is normal for the free tier."
      />

      {/* .env.local sample */}
      <div className="card p-6 space-y-4 fade-up fade-up-4 mb-8">
        <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Your .env.local file</p>
        <p className="text-sm text-stone-500">
          Open <code className="font-mono bg-stone-100 px-1.5 py-0.5 rounded text-xs">.env.local</code> in
          the project root and paste your keys:
        </p>
        <pre className="bg-stone-900 text-stone-100 rounded-sm p-4 text-xs font-mono leading-relaxed overflow-x-auto">
{`APP_URL=http://localhost:3000

# Free — required for AI features
GOOGLE_AI_KEY=AIzaSy...
HF_TOKEN=hf_...

ENABLE_PLAN_ENHANCEMENT=true`}
        </pre>
        <p className="font-mono text-[10px] text-stone-400">
          After editing, restart with <code className="bg-stone-100 px-1 py-0.5 rounded">npm run dev</code>
        </p>
      </div>

      {/* Sharp note */}
      <div className="border border-stone-200 rounded-sm p-5 space-y-2 fade-up fade-up-4 mb-8">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-sm border border-green-500 bg-green-50 flex items-center justify-center text-[9px] text-green-600">✓</span>
          <p className="font-mono text-xs uppercase tracking-widest text-stone-600">Plan Enhancement — Always Free</p>
        </div>
        <p className="text-sm text-stone-500 leading-relaxed">
          Plan image enhancement (contrast, sharpening, white balance) uses{" "}
          <strong>Sharp</strong> — a local npm package. No API key needed, runs on your machine,
          completely free forever.
        </p>
        <p className="text-sm text-stone-500">
          Install it by running: <code className="font-mono bg-stone-100 px-1.5 py-0.5 rounded text-xs">npm install</code>
        </p>
      </div>

      <div className="flex items-center gap-4 pt-2 fade-up fade-up-4">
        <a href="/" className="btn-primary">Start a project →</a>
        <a href="/settings" className="btn-secondary">Set up firm profile</a>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusRow({ label, ok, free }: { label: string; ok: boolean; free?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-4 h-4 rounded-sm border flex items-center justify-center text-[9px] flex-shrink-0 ${
        ok ? "border-green-500 bg-green-50 text-green-600" : "border-stone-200 text-stone-300"
      }`}>
        {ok ? "✓" : "·"}
      </span>
      <span className="text-xs text-stone-600 flex-1">{label}</span>
      {free && <span className="font-mono text-[9px] text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-sm">FREE</span>}
      {!ok && <span className="font-mono text-[9px] text-stone-300">not set</span>}
    </div>
  );
}

function SetupStep({
  num, title, badge, badgeColor, steps, what, note,
}: {
  num: string;
  title: string;
  badge: string;
  badgeColor: string;
  steps: { label: string; code?: string; link?: { text: string; url: string } }[];
  what: string;
  note?: string;
}) {
  return (
    <div className="card p-6 space-y-5 mb-5 fade-up fade-up-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="font-mono text-xl text-stone-200 leading-none">{num}</span>
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-stone-700">{title}</p>
            <p className="text-xs text-stone-400 mt-1 leading-relaxed">{what}</p>
          </div>
        </div>
        <span className={`font-mono text-[9px] uppercase tracking-widest px-2 py-1 rounded-sm flex-shrink-0 ${badgeColor}`}>
          {badge}
        </span>
      </div>

      <div className="border-t border-stone-100 pt-4 space-y-2.5">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="font-mono text-[10px] text-stone-300 pt-0.5 flex-shrink-0 w-4">
              {i + 1}.
            </span>
            <div className="flex-1">
              <p className="text-sm text-stone-600">
                {step.label}{" "}
                {step.link && (
                  <a href={step.link.url} target="_blank" rel="noreferrer"
                    className="text-stone-800 underline underline-offset-2 hover:text-stone-600">
                    {step.link.text} ↗
                  </a>
                )}
              </p>
              {step.code && (
                <code className="block mt-1 font-mono text-xs bg-stone-900 text-stone-100 px-3 py-2 rounded-sm">
                  {step.code}
                </code>
              )}
            </div>
          </div>
        ))}
      </div>

      {note && (
        <div className="border-t border-stone-100 pt-3 flex items-start gap-2">
          <span className="text-amber-500 flex-shrink-0 text-xs">ℹ</span>
          <p className="text-xs text-stone-500 leading-relaxed">{note}</p>
        </div>
      )}
    </div>
  );
}
