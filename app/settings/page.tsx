"use client";

import { useEffect, useRef, useState, ChangeEvent } from "react";
import type { FirmProfile, PdfAccentColor, PdfFontStyle } from "@/types";

// ─── Config options ───────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name,         setName]         = useState("");
  const [tagline,      setTagline]      = useState("");
  const [address,      setAddress]      = useState("");
  const [phone,        setPhone]        = useState("");
  const [email,        setEmail]        = useState("");
  const [website,      setWebsite]      = useState("");
  const [coverTagline, setCoverTagline] = useState("");
  const [accentColor,  setAccentColor]  = useState<PdfAccentColor>("graphite");
  const [fontStyle,    setFontStyle]    = useState<PdfFontStyle>("editorial");

  // Logo
  const [logoFile,    setLogoFile]    = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [existingLogo, setExistingLogo] = useState<string | null>(null);

  // UI
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"identity" | "pdf" | "contact">("identity");

  // ── Load existing profile ────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/firm")
      .then((r) => r.json())
      .then((d) => {
        const f: FirmProfile | null = d.firm;
        if (f) {
          setName(f.name ?? "");
          setTagline(f.tagline ?? "");
          setAddress(f.address ?? "");
          setPhone(f.phone ?? "");
          setEmail(f.email ?? "");
          setWebsite(f.website ?? "");
          setCoverTagline(f.coverTagline ?? "");
          setAccentColor(f.accentColor ?? "graphite");
          setFontStyle(f.fontStyle ?? "editorial");
          if (f.logoUrl) setExistingLogo(f.logoUrl);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── Logo file picker ─────────────────────────────────────────────────────
  function onLogoChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError("Logo must be under 5 MB"); return; }
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
    setError(null);
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Firm name is required"); return; }

    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("name",         name.trim());
      fd.append("tagline",      tagline.trim());
      fd.append("address",      address.trim());
      fd.append("phone",        phone.trim());
      fd.append("email",        email.trim());
      fd.append("website",      website.trim());
      fd.append("coverTagline", coverTagline.trim());
      fd.append("accentColor",  accentColor);
      fd.append("fontStyle",    fontStyle);
      if (logoFile) fd.append("logo", logoFile);

      const res  = await fetch("/api/firm", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) { setError(data.error ?? "Save failed"); return; }

      if (data.firm.logoUrl) setExistingLogo(data.firm.logoUrl);
      setLogoFile(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  // ── Preview accent color ─────────────────────────────────────────────────
  const accentHex = ACCENT_OPTIONS.find((o) => o.value === accentColor)?.hex ?? "#2d2b27";

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">

      {/* Header */}
      <div className="mb-10 fade-up fade-up-1">
        <div className="flex items-center gap-3 mb-2">
          <SettingsIcon />
          <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Firm Settings</p>
        </div>
        <h1 className="font-display text-4xl font-light text-stone-900"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          Your Firm Profile
        </h1>
        <p className="text-stone-500 text-sm mt-2">
          Set this up once. Your name, logo, and PDF style will be applied to every project automatically.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-8 border-b border-stone-200 fade-up fade-up-2">
        {(["identity", "pdf", "contact"] as const).map((tab) => (
          <button key={tab} type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 font-mono text-[10px] uppercase tracking-widest transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-stone-900 text-stone-900"
                : "border-transparent text-stone-400 hover:text-stone-700"
            }`}>
            {tab === "identity" ? "01 — Identity"
           : tab === "pdf"      ? "02 — PDF Style"
           :                      "03 — Contact"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSave} className="space-y-8">

        {/* ── Tab 1: Identity ─────────────────────────────────────────── */}
        {activeTab === "identity" && (
          <div className="space-y-6 fade-up fade-up-2">

            {/* Firm name */}
            <div className="card p-6 space-y-5">
              <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Firm Name & Tagline</p>
              <div>
                <label className="field-label">Firm Name *</label>
                <input className="field-input text-base" type="text"
                  placeholder="e.g. Studio Forma"
                  value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label className="field-label">Tagline</label>
                <input className="field-input" type="text"
                  placeholder="e.g. Architecture & Interiors"
                  value={tagline} onChange={(e) => setTagline(e.target.value)} />
                <p className="font-mono text-[10px] text-stone-400 mt-1">
                  Shown below your firm name in the PDF footer.
                </p>
              </div>
              <div>
                <label className="field-label">PDF Cover Tagline</label>
                <input className="field-input" type="text"
                  placeholder="e.g. Where Space Meets Story"
                  value={coverTagline} onChange={(e) => setCoverTagline(e.target.value)} />
                <p className="font-mono text-[10px] text-stone-400 mt-1">
                  A memorable line printed large on every client PDF cover.
                </p>
              </div>
            </div>

            {/* Logo upload */}
            <div className="card p-6 space-y-4">
              <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Firm Logo</p>
              <p className="text-sm text-stone-500">
                Used on the PDF cover and headers. PNG or SVG with transparent background recommended.
              </p>

              {/* Current logo preview */}
              {(logoPreview || existingLogo) && (
                <div className="border border-stone-200 rounded-sm p-4 bg-white flex items-center gap-4">
                  <img
                    src={logoPreview ?? existingLogo!}
                    alt="Logo preview"
                    className="max-h-16 max-w-[160px] object-contain"
                  />
                  <div className="flex-1">
                    <p className="text-xs text-stone-500">
                      {logoPreview ? "New logo selected (not saved yet)" : "Current logo"}
                    </p>
                    {logoPreview && (
                      <button type="button" className="btn-ghost text-[10px] text-red-400 pl-0 mt-1"
                        onClick={() => { setLogoFile(null); setLogoPreview(null); if (logoInputRef.current) logoInputRef.current.value = ""; }}>
                        ✕ Remove new logo
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div
                className={`upload-zone p-8 text-center cursor-pointer ${logoPreview ? "border-stone-300" : ""}`}
                onClick={() => logoInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) { const ev = { target: { files: [f] } } as unknown as ChangeEvent<HTMLInputElement>; onLogoChange(ev); }
                }}
              >
                <input ref={logoInputRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp"
                  className="hidden" onChange={onLogoChange} />
                <div className="space-y-2">
                  <div className="w-8 h-8 border border-stone-200 rounded-sm flex items-center justify-center mx-auto">
                    <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 002 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-sm text-stone-500">
                    {existingLogo ? "Upload a new logo" : "Drop logo here or browse"}
                  </p>
                  <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">
                    PNG · SVG · JPEG · WebP · Max 5 MB
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 2: PDF Style ─────────────────────────────────────────── */}
        {activeTab === "pdf" && (
          <div className="space-y-6 fade-up fade-up-2">

            {/* Accent color */}
            <div className="card p-6 space-y-5">
              <div>
                <p className="font-mono text-xs tracking-widest text-stone-400 uppercase mb-1">Accent Color</p>
                <p className="text-sm text-stone-500">Used for the PDF sidebar stripe, headings, and page number accents.</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {ACCENT_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button"
                    onClick={() => setAccentColor(opt.value)}
                    className={`flex items-center gap-3 p-3 border rounded-sm transition-all text-left ${
                      accentColor === opt.value
                        ? "border-stone-900 bg-white"
                        : "border-stone-200 hover:border-stone-400"
                    }`}>
                    <span className="w-6 h-6 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: opt.hex }} />
                    <span className="font-mono text-[10px] uppercase tracking-wide text-stone-700">
                      {opt.label}
                    </span>
                    {accentColor === opt.value && (
                      <span className="ml-auto text-stone-500 text-xs">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Font style */}
            <div className="card p-6 space-y-5">
              <div>
                <p className="font-mono text-xs tracking-widest text-stone-400 uppercase mb-1">PDF Typography</p>
                <p className="text-sm text-stone-500">Sets the personality of all text in the exported PDF deck.</p>
              </div>
              <div className="space-y-2">
                {FONT_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button"
                    onClick={() => setFontStyle(opt.value)}
                    className={`w-full flex items-center gap-4 p-4 border rounded-sm transition-all text-left ${
                      fontStyle === opt.value
                        ? "border-stone-900 bg-white"
                        : "border-stone-200 hover:border-stone-400"
                    }`}>
                    <FontPreview style={opt.value} />
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-stone-800">{opt.label}</p>
                      <p className="text-xs text-stone-400 mt-0.5">{opt.desc}</p>
                    </div>
                    {fontStyle === opt.value && (
                      <span className="ml-auto text-stone-500 text-sm flex-shrink-0">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Live preview strip */}
            <div className="rounded-sm overflow-hidden border border-stone-200">
              <div className="h-2" style={{ backgroundColor: accentHex }} />
              <div className="bg-[#f7f5f2] px-6 py-5 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-widest text-stone-400 mb-0.5">
                    Concept Presentation
                  </p>
                  <p className={`text-xl font-semibold text-stone-900 ${fontStyle === "editorial" ? "font-display" : ""}`}
                     style={fontStyle === "editorial" ? { fontFamily: "'Cormorant Garamond', serif" } : {}}>
                    {name || "Your Firm Name"}
                  </p>
                  {coverTagline && (
                    <p className="text-xs text-stone-500 mt-0.5 italic">{coverTagline}</p>
                  )}
                </div>
                {(logoPreview || existingLogo) && (
                  <img src={logoPreview ?? existingLogo!} alt="logo"
                    className="max-h-10 max-w-[100px] object-contain opacity-80" />
                )}
              </div>
              <div className="px-6 py-2 flex justify-between items-center" style={{ backgroundColor: accentHex }}>
                <p className="font-mono text-[8px] text-white/60 uppercase tracking-widest">
                  {name || "Firm Name"}  ·  {tagline || "Architecture"}
                </p>
                <p className="font-mono text-[8px] text-white/60">1 / 6</p>
              </div>
              <p className="font-mono text-[9px] text-stone-400 text-center py-2 bg-stone-100">
                PDF cover preview
              </p>
            </div>
          </div>
        )}

        {/* ── Tab 3: Contact ───────────────────────────────────────────── */}
        {activeTab === "contact" && (
          <div className="space-y-6 fade-up fade-up-2">
            <div className="card p-6 space-y-5">
              <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Contact Details</p>
              <p className="text-sm text-stone-500">
                Printed in the PDF footer on every page so clients know how to reach you.
              </p>
              <div>
                <label className="field-label">Office Address</label>
                <textarea className="field-input resize-none" rows={2}
                  placeholder="e.g. 12 MG Road, Indiranagar, Bengaluru 560038"
                  value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Phone</label>
                  <input className="field-input" type="tel"
                    placeholder="+91 98765 43210"
                    value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Email</label>
                  <input className="field-input" type="email"
                    placeholder="hello@studioforma.in"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="field-label">Website</label>
                <input className="field-input" type="text"
                  placeholder="www.studioforma.in"
                  value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
            </div>

            {/* Contact footer preview */}
            <div className="rounded-sm overflow-hidden border border-stone-200">
              <div className="bg-[#f7f5f2] px-6 py-3 border-t border-stone-200 flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="font-mono text-[9px] text-stone-600 uppercase tracking-widest">
                    {name || "Firm Name"}{tagline ? `  ·  ${tagline}` : ""}
                  </p>
                  {(phone || email || website) && (
                    <p className="font-mono text-[9px] text-stone-400">
                      {[phone, email, website].filter(Boolean).join("  ·  ")}
                    </p>
                  )}
                  {address && (
                    <p className="font-mono text-[9px] text-stone-400">{address}</p>
                  )}
                </div>
                <p className="font-mono text-[9px] text-stone-400">1 / 6</p>
              </div>
              <p className="font-mono text-[9px] text-stone-400 text-center py-2 bg-stone-100">
                PDF footer preview
              </p>
            </div>
          </div>
        )}

        {/* ── Error + Save bar ──────────────────────────────────────────── */}
        {error && (
          <div className="border border-red-200 bg-red-50 rounded-sm px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-stone-200">
          <div className="flex items-center gap-3">
            {saved && (
              <span className="font-mono text-xs text-amber-600 uppercase tracking-widest fade-up fade-up-1">
                ✓ Saved
              </span>
            )}
            <p className="font-mono text-[10px] text-stone-400">
              Changes apply to all future PDF exports.
            </p>
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? (
              <><span className="spinner" /><span>Saving…</span></>
            ) : (
              "Save Firm Profile"
            )}
          </button>
        </div>

      </form>

      {/* ── Profile completion checklist ─────────────────────────── */}
      <div className="mt-10 card p-6 space-y-4">
        <p className="font-mono text-xs tracking-widest text-stone-400 uppercase">Profile Completion</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Firm name",     done: !!name },
            { label: "Logo",          done: !!(logoPreview || existingLogo) },
            { label: "Tagline",       done: !!tagline },
            { label: "Email",         done: !!email },
            { label: "Phone",         done: !!phone },
            { label: "Address",       done: !!address },
            { label: "Accent colour", done: true },
            { label: "Cover tagline", done: !!coverTagline },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className={`w-4 h-4 rounded-sm border flex items-center justify-center text-[9px] flex-shrink-0 transition-colors ${
                item.done ? "border-amber-500 bg-amber-50 text-amber-600" : "border-stone-200 text-stone-300"
              }`}>
                {item.done ? "✓" : "·"}
              </span>
              <span className="text-xs text-stone-500">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="progress-bar mt-1">
          <div className="progress-bar-fill" style={{
            width: `${([name, logoPreview || existingLogo, tagline, email, phone, address, true, coverTagline].filter(Boolean).length / 8) * 100}%`,
            background: "#c47b2a",
          }} />
        </div>
      </div>

      {/* ── Danger zone ──────────────────────────────────────────── */}
      <div className="mt-6 border border-red-100 rounded-sm p-6 space-y-3">
        <p className="font-mono text-xs tracking-widest text-red-400 uppercase">Danger Zone</p>
        <p className="text-sm text-stone-500">
          Clear your firm profile settings. Your projects will not be affected.
        </p>
        <button type="button"
          className="font-mono text-xs uppercase tracking-widest text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-4 py-2 rounded-sm transition-colors"
          onClick={() => {
            if (!confirm("Reset firm profile? This cannot be undone.")) return;
            setName(""); setTagline(""); setAddress(""); setPhone("");
            setEmail(""); setWebsite(""); setCoverTagline("");
            setAccentColor("graphite"); setFontStyle("editorial");
            setLogoFile(null); setLogoPreview(null); setExistingLogo(null);
          }}>
          Reset firm profile
        </button>
      </div>

    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FontPreview({ style }: { style: PdfFontStyle }) {
  const samples: Record<PdfFontStyle, { char: string; css: React.CSSProperties }> = {
    editorial: { char: "Aa",  css: { fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontSize: 22 } },
    modern:    { char: "Aa",  css: { fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 400, fontSize: 18 } },
    classic:   { char: "Aa",  css: { fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 400, fontSize: 20 } },
  };
  const s = samples[style];
  return (
    <div className="w-12 h-10 border border-stone-100 rounded-sm flex items-center justify-center flex-shrink-0 bg-stone-50">
      <span className="text-stone-700" style={s.css}>{s.char}</span>
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function PageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
      <div className="skeleton h-8 w-48" />
      <div className="skeleton h-4 w-96" />
      <div className="skeleton h-10 w-full" />
      <div className="skeleton h-64 w-full" />
    </div>
  );
}
