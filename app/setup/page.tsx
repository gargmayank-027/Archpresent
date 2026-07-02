"use client";

import { useEffect, useState } from "react";

interface ProviderStatus {
  gemini:       "ok" | "missing";
  groq:         "ok" | "missing";
  unsplash:     "ok" | "missing";
  pollinations: "ok" | "unkeyed";
  anthropic:    "ok" | "missing";
  openai:       "ok" | "missing";
  replicate:    "ok" | "missing";
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
          Two free keys,<br />real moodboards.
        </h1>
        <p className="text-stone-500 text-sm leading-relaxed">
          First-draft moodboards use real, sourceable interior photography (the Pinterest-style
          workflow most firms already use) via a free Unsplash key. A free Gemini key powers
          plan analysis. AI generation (Pollinations) works with no setup at all, for whenever
          you want a more conceptual alternative to a real photo.
        </p>
      </div>

      {/* Status indicators */}
      {status && (
        <div className="card p-5 mb-8 space-y-3 fade-up fade-up-2">
          <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Current Status</p>
          <div className="grid grid-cols-2 gap-2">
            <StatusRow label="Gemini Flash (analysis)"     ok={status.gemini === "ok"}       free />
            <StatusRow label="Groq / Llama 4 Scout (fallback)" ok={(status as any).groq === "ok"} free />
            <StatusRow label="Unsplash (real photos)"      ok={status.unsplash === "ok"}     free />
            <StatusRow label="Pollinations.ai (AI images)" ok={status.pollinations === "ok"} free
              hint={status.pollinations === "unkeyed" ? "working, unkeyed" : undefined} />
            <StatusRow label="Claude (analysis)"           ok={status.anthropic === "ok"} />
            <StatusRow label="GPT-4o (analysis)"           ok={status.openai === "ok"} />
            <StatusRow label="Replicate (images)"          ok={status.replicate === "ok"} />
          </div>
        </div>
      )}

      {/* Step 1 — Unsplash (real photo first drafts) */}
      <SetupStep
        num="01"
        title="Unsplash — Real Photo Moodboards"
        badge="Free · 50 req/hour"
        badgeColor="bg-green-100 text-green-700"
        steps={[
          { label: "Go to", link: { text: "unsplash.com/developers", url: "https://unsplash.com/developers" } },
          { label: "Sign up / log in, click \"New Application\"" },
          { label: "Accept the API guidelines" },
          { label: 'Name it "ArchPresent", give a one-line description' },
          { label: "Copy the Access Key (not the Secret Key)" },
          { label: 'Add to your .env.local file:', code: "UNSPLASH_ACCESS_KEY=..." },
          { label: "Restart the dev server: npm run dev" },
        ]}
        what="Finds real, photographer-credited interior photos matched to each room's style and your plain-English brief — the same first-draft workflow most firms already do on Pinterest, except sourced from an API that's actually free and legal to use."
        note="50 requests/hour on the free tier. Each room load uses one request; results are cached for 5 minutes. Without this key, the app generates AI images instead of real photos as the first draft."
      />

      {/* Step 2 — Groq (free fallback for when Gemini hits rate limits) */}
      <SetupStep
        num="02"
        title="Groq — Free AI Fallback (Recommended)"
        badge="Free · 14,400 req/day"
        badgeColor="bg-green-100 text-green-700"
        steps={[
          { label: "Go to", link: { text: "console.groq.com", url: "https://console.groq.com" } },
          { label: "Sign in with Google or GitHub (no credit card needed)" },
          { label: "Go to API Keys → Create API Key" },
          { label: 'Copy the key (starts with gsk_)' },
          { label: 'Add to Vercel environment variables:', code: "GROQ_API_KEY=gsk_..." },
          { label: "Redeploy — Groq is now the automatic fallback when Gemini rate-limits" },
        ]}
        what="Groq runs Llama 4 Scout Vision on custom chips — genuinely free, no credit card, 14,400 requests/day. When Gemini hits its 15 req/min limit (which happens if you click Re-analyse quickly), the app automatically falls back to Groq instead of showing an error."
        note="Gemini → Groq → Claude → GPT-4o: each provider is tried automatically when the previous one rate-limits. With both Gemini and Groq set, you're covered for virtually any usage pattern."
      />

      {/* Step 3 — Gemini */}
      <SetupStep
        num="03"
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

      {/* Step 3 — Pollinations (works without a key, better with one) */}
      <div className="card p-6 space-y-4 mb-5 fade-up fade-up-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="font-mono text-xl text-stone-200 leading-none">04</span>
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-stone-700">
                Pollinations.ai — AI-Generated Alternative
              </p>
              <p className="text-xs text-stone-400 mt-1 leading-relaxed">
                Click "✨ Generate with AI" on any moodboard image to swap a real photo for an
                AI-generated concept — useful when you want something more conceptual or specific
                than what exists in stock photography.
              </p>
            </div>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-widest px-2 py-1 rounded-sm flex-shrink-0 bg-green-100 text-green-700">
            Free
          </span>
        </div>
        <div className="border-t border-stone-100 pt-4 space-y-2.5">
          <p className="text-sm text-stone-600 leading-relaxed">
            Works automatically with no setup. For best reliability, add a free key
            (recommended — avoids "queue full" errors during busy periods):
          </p>
          <ol className="text-xs text-stone-500 leading-relaxed list-decimal list-inside space-y-0.5">
            <li>Go to <a href="https://enter.pollinations.ai" target="_blank" rel="noreferrer" className="underline font-medium text-stone-700">enter.pollinations.ai</a></li>
            <li>Sign in with GitHub (free, no credit card)</li>
            <li>Create a key, copy it</li>
            <li>Add to .env.local: <code className="bg-stone-100 px-1.5 py-0.5 rounded">POLLINATIONS_API_KEY=pk_...</code></li>
            <li>Restart: <code className="bg-stone-100 px-1.5 py-0.5 rounded">npm run dev</code></li>
          </ol>
        </div>
      </div>

      {/* .env.local sample */}
      <div className="card p-6 space-y-4 fade-up fade-up-4 mb-8">
        <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Your .env.local file</p>
        <p className="text-sm text-stone-500">
          Open <code className="font-mono bg-stone-100 px-1.5 py-0.5 rounded text-xs">.env.local</code> in
          the project root and paste your keys:
        </p>
        <pre className="bg-stone-900 text-stone-100 rounded-sm p-4 text-xs font-mono leading-relaxed overflow-x-auto">
{`APP_URL=http://localhost:3000

# Free — required for plan analysis
GOOGLE_AI_KEY=AIzaSy...

# Moodboard images need no key at all — Pollinations.ai is always on

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

function StatusRow({ label, ok, free, hint }: { label: string; ok: boolean; free?: boolean; hint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-4 h-4 rounded-sm border flex items-center justify-center text-[9px] flex-shrink-0 ${
        ok ? "border-green-500 bg-green-50 text-green-600" : hint ? "border-amber-400 bg-amber-50 text-amber-600" : "border-stone-200 text-stone-300"
      }`}>
        {ok ? "✓" : hint ? "~" : "·"}
      </span>
      <span className="text-xs text-stone-600 flex-1">{label}</span>
      {free && <span className="font-mono text-[9px] text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-sm">FREE</span>}
      {hint && <span className="font-mono text-[9px] text-amber-500">{hint}</span>}
      {!ok && !hint && <span className="font-mono text-[9px] text-stone-300">not set</span>}
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
