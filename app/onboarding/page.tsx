"use client";

import { useState, useRef, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { PdfAccentColor, PdfFontStyle } from "@/types";

const ACCENT_OPTIONS: { value: PdfAccentColor; label: string; hex: string }[] = [
  { value: "graphite",   label: "Graphite",   hex: "#2d2b27" },
  { value: "navy",       label: "Navy",       hex: "#1a2744" },
  { value: "forest",     label: "Forest",     hex: "#1a3a2a" },
  { value: "terracotta", label: "Terracotta", hex: "#8b3a1e" },
  { value: "slate",      label: "Slate",      hex: "#2a3540" },
  { value: "plum",       label: "Plum",       hex: "#3a1a44" },
];

const FONT_OPTIONS: { value: PdfFontStyle; label: string; desc: string }[] = [
  { value: "editorial", label: "Editorial",  desc: "Serif display — warm, architectural" },
  { value: "modern",    label: "Modern",     desc: "Helvetica — clean, Swiss precision" },
  { value: "classic",   label: "Classic",    desc: "Times — formal, traditional practice" },
];

export default function OnboardingPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Steps: 1 = Identity, 2 = Brand, 3 = Contact
  const [step, setStep] = useState(1);

  // Form state
  const [name,         setName]         = useState("");
  const [tagline,      setTagline]      = useState("");
  const [coverTagline, setCoverTagline] = useState("");
  const [accentColor,  setAccentColor]  = useState<PdfAccentColor>("graphite");
  const [fontStyle,    setFontStyle]    = useState<PdfFontStyle>("editorial");
  const [phone,        setPhone]        = useState("");
  const [email,        setEmail]        = useState(session?.user?.email ?? "");
  const [website,      setWebsite]      = useState("");
  const [address,      setAddress]      = useState("");

  // Logo
  const [logoFile,    setLogoFile]    = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // UI
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  function onLogoChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError("Logo must be under 5 MB"); return; }
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  }

  async function handleComplete() {
    if (!name.trim()) { setError("Your firm name is required."); setStep(1); return; }
    setSaving(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      if (tagline.trim())      fd.append("tagline", tagline.trim());
      if (coverTagline.trim()) fd.append("coverTagline", coverTagline.trim());
      fd.append("accentColor", accentColor);
      fd.append("fontStyle", fontStyle);
      if (phone.trim())   fd.append("phone", phone.trim());
      if (email.trim())   fd.append("email", email.trim());
      if (website.trim()) fd.append("website", website.trim());
      if (address.trim()) fd.append("address", address.trim());
      if (logoFile)        fd.append("logo", logoFile);

      const res = await fetch("/api/firm", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Save failed");
      }

      // Small delay to let Vercel Blob settle, then redirect
      await new Promise((r) => setTimeout(r, 500));
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const canProceed = step === 1 ? name.trim().length > 0 : true;

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg fade-up fade-up-1">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-6">
            <span className="font-mono text-[10px] tracking-[0.2em] text-stone-400 uppercase">Arch</span>
            <span className="w-px h-4 bg-stone-300" />
            <span className="font-display text-xl font-light text-stone-600"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}>Present</span>
          </div>
          <h1 className="font-display text-3xl font-light text-stone-900 mb-2"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            {step === 1 && "Set up your firm"}
            {step === 2 && "Brand your presentations"}
            {step === 3 && "Contact details"}
          </h1>
          <p className="text-sm text-stone-500">
            {step === 1 && "We'll use this to personalise every PDF you export."}
            {step === 2 && "Choose how your concept decks should look."}
            {step === 3 && "Optional — shown on the cover slide of your decks."}
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-[10px] transition-all ${
                s < step ? "bg-amber-500 text-white"
                : s === step ? "border-2 border-stone-800 text-stone-800"
                : "border border-stone-300 text-stone-300"
              }`}>
                {s < step ? "✓" : s}
              </div>
              {s < 3 && <div className={`w-12 h-px ${s < step ? "bg-amber-400" : "bg-stone-200"}`} />}
            </div>
          ))}
        </div>

        {error && (
          <div className="alert alert-error mb-6 text-sm">{error}</div>
        )}

        {/* ── Step 1: Identity ─────────────────────────────────────────── */}
        {step === 1 && (
          <div className="card p-6 space-y-5">
            <div>
              <label className="field-label">Firm name *</label>
              <input type="text" className="field-input" placeholder="e.g. Studio Forma"
                value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="field-label">Tagline</label>
              <input type="text" className="field-input" placeholder="e.g. Architecture & Interiors"
                value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Cover tagline</label>
              <input type="text" className="field-input" placeholder="e.g. Where Space Meets Story"
                value={coverTagline} onChange={(e) => setCoverTagline(e.target.value)} />
              <p className="font-mono text-[9px] text-stone-400 mt-1">Shown on the cover slide of every PDF.</p>
            </div>
            <div>
              <label className="field-label">Firm logo</label>
              <div className="flex items-center gap-4">
                {logoPreview ? (
                  <div className="w-16 h-16 border border-stone-200 rounded-sm overflow-hidden bg-white flex items-center justify-center p-1">
                    <img src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain" />
                  </div>
                ) : (
                  <div className="w-16 h-16 border border-dashed border-stone-300 rounded-sm flex items-center justify-center cursor-pointer hover:border-stone-400 transition-colors"
                    onClick={() => logoInputRef.current?.click()}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                    </svg>
                  </div>
                )}
                <div>
                  <button type="button" onClick={() => logoInputRef.current?.click()}
                    className="font-mono text-[10px] text-stone-500 hover:text-stone-700 underline uppercase tracking-widest">
                    {logoPreview ? "Change" : "Upload"}
                  </button>
                  <p className="font-mono text-[9px] text-stone-400 mt-0.5">PNG or JPEG, max 5 MB</p>
                </div>
                <input ref={logoInputRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden"
                  onChange={onLogoChange} />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Brand ────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="card p-6 space-y-6">
            <div>
              <label className="field-label">Accent color</label>
              <p className="text-[11px] text-stone-400 mb-3">Used for the sidebar, headings, and dividers in your PDF.</p>
              <div className="grid grid-cols-6 gap-2">
                {ACCENT_OPTIONS.map((a) => (
                  <button key={a.value} type="button"
                    onClick={() => setAccentColor(a.value)}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-sm border transition-all ${
                      accentColor === a.value
                        ? "border-stone-800 bg-stone-50 shadow-sm"
                        : "border-stone-200 hover:border-stone-400"
                    }`}>
                    <div className="w-6 h-6 rounded-full border border-stone-200" style={{ background: a.hex }} />
                    <span className="font-mono text-[8px] text-stone-500 uppercase tracking-wider">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="field-label">Typography</label>
              <p className="text-[11px] text-stone-400 mb-3">Sets the personality of your presentation text.</p>
              <div className="space-y-2">
                {FONT_OPTIONS.map((f) => (
                  <button key={f.value} type="button"
                    onClick={() => setFontStyle(f.value)}
                    className={`w-full text-left px-4 py-3 rounded-sm border transition-all flex items-center justify-between ${
                      fontStyle === f.value
                        ? "border-stone-800 bg-stone-50 shadow-sm"
                        : "border-stone-200 hover:border-stone-400"
                    }`}>
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-stone-700">{f.label}</span>
                      <span className="block text-[11px] text-stone-400 mt-0.5">{f.desc}</span>
                    </div>
                    {fontStyle === f.value && (
                      <span className="w-4 h-4 rounded-full bg-stone-800 flex items-center justify-center flex-shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Contact ──────────────────────────────────────────── */}
        {step === 3 && (
          <div className="card p-6 space-y-4">
            <p className="text-[11px] text-stone-400 mb-2">
              All optional — these appear on the cover page of exported PDFs.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Phone</label>
                <input type="tel" className="field-input" placeholder="+91 98765 43210"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label className="field-label">Email</label>
                <input type="email" className="field-input" placeholder="hello@studio.in"
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="field-label">Website</label>
              <input type="text" className="field-input" placeholder="www.studio.in"
                value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Address</label>
              <textarea className="field-input resize-none" rows={2} placeholder="12 MG Road, Bengaluru 560001"
                value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          {step > 1 ? (
            <button type="button" onClick={() => setStep(step - 1)} disabled={saving}
              className="btn-ghost">← Back</button>
          ) : <div />}

          {step < 3 ? (
            <button type="button" onClick={() => setStep(step + 1)} disabled={!canProceed}
              className="btn-primary">
              Continue →
            </button>
          ) : (
            <button type="button" onClick={handleComplete} disabled={saving}
              className="btn-primary flex items-center gap-2">
              {saving ? <><span className="spinner w-3 h-3" style={{ borderWidth: 1 }} /> Setting up…</> : "Complete setup →"}
            </button>
          )}
        </div>

        {/* Skip link */}
        {step === 3 && (
          <p className="text-center mt-4">
            <button type="button" onClick={handleComplete} disabled={saving}
              className="font-mono text-[10px] text-stone-400 hover:text-stone-600 uppercase tracking-widest transition-colors">
              Skip for now
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
