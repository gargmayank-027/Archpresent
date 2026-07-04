"use client";

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { StepIndicator } from "@/components/StepIndicator";
import type { PlotFacing, PropertyType, FloorLocation } from "@/types";

const FACING_OPTIONS: PlotFacing[] = [
  "North", "South", "East", "West",
  "North-East", "North-West", "South-East", "South-West",
];

const PROPERTY_TYPES: PropertyType[] = [
  "Apartment", "Independent House", "Villa", "Penthouse", "Studio",
];

const FLOOR_LOCATIONS: FloorLocation[] = [
  "Ground", "Lower", "Mid", "Top", "Duplex",
];

export default function NewProjectPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Presentation type selector ──────────────────────────────────────────
  const [presentationType, setPresentationType] = useState<"concept" | "interior" | null>(null);

  // ── Project meta ───────────────────────────────────────────────────────────
  const [name, setName]             = useState("");
  const [clientName, setClientName] = useState("");
  const [firmName, setFirmName]     = useState("");

  // ── Auto-populate firm name from saved profile ─────────────────────────────
  useEffect(() => {
    fetch("/api/firm")
      .then((r) => r.json())
      .then((d) => { if (d.firm?.name) setFirmName(d.firm.name); })
      .catch(() => {});
  }, []);

  // ── Location / site context ────────────────────────────────────────────────
  const [city, setCity]       = useState("");
  const [state_, setState_]   = useState("");
  const [country, setCountry] = useState("India");

  // ── Plot / site info ───────────────────────────────────────────────────────
  const [plotAreaSqm, setPlotAreaSqm]           = useState("");
  const [builtUpAreaSqm, setBuiltUpAreaSqm]     = useState("");
  const [facing, setFacing]                     = useState<PlotFacing | "">("");
  const [propertyType, setPropertyType]         = useState<PropertyType | "">("");
  const [numberOfBedrooms, setNumberOfBedrooms] = useState("");
  const [numberOfFloors, setNumberOfFloors]     = useState("");
  const [floorLocation, setFloorLocation]       = useState<FloorLocation | "">("");
  const [vaastuCompliance, setVaastuCompliance] = useState(false);
  const [additionalNotes, setAdditionalNotes]   = useState("");

  // ── File upload ────────────────────────────────────────────────────────────
  const [file, setFile]         = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const STEPS = [
    { num: "1", label: "Upload",     status: "active"  as const },
    { num: "2", label: "Review",     status: "pending" as const },
    { num: "3", label: "Moodboards", status: "pending" as const },
    { num: "4", label: "Export",     status: "pending" as const },
  ];

  function handleFileSelect(f: File) {
    const allowed = ["image/png", "image/jpeg", "application/pdf"];
    if (!allowed.includes(f.type)) { setError("Please upload a PNG, JPEG, or PDF file."); return; }
    if (f.size > 20 * 1024 * 1024)  { setError("File must be under 20 MB."); return; }
    setError(null);
    setFile(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFileSelect(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file)              { setError("Please select a plan file."); return; }
    if (!name.trim())       { setError("Project name is required."); return; }
    if (!clientName.trim()) { setError("Client name is required."); return; }

    setUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("name",       name.trim());
      fd.append("clientName", clientName.trim());
      fd.append("firmName",   firmName.trim() || "Architecture Studio");
      if (presentationType) fd.append("presentationType", presentationType);
      fd.append("plan",       file);

      // Site context — only append if filled in
      if (city.trim())        fd.append("city",           city.trim());
      if (state_.trim())      fd.append("state",          state_.trim());
      if (country.trim())     fd.append("country",        country.trim());
      if (plotAreaSqm)      fd.append("plotAreaSqm",      plotAreaSqm);
      if (builtUpAreaSqm)   fd.append("builtUpAreaSqm",   builtUpAreaSqm);
      if (facing)           fd.append("facing",           facing);
      if (propertyType)     fd.append("propertyType",     propertyType);
      if (numberOfBedrooms) fd.append("numberOfBedrooms", numberOfBedrooms);
      if (numberOfFloors)   fd.append("numberOfFloors",   numberOfFloors);
      if (floorLocation)    fd.append("floorLocation",    floorLocation);
      fd.append("vaastuCompliance", String(vaastuCompliance));
      if (additionalNotes.trim()) fd.append("additionalNotes", additionalNotes.trim());

      const res  = await fetch("/api/projects", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) { setError(data.error ?? "Upload failed"); return; }
      router.push(`/project/${data.project.id}/review`);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setUploading(false);
    }
  }

  // ── Type selector screen ───────────────────────────────────────────────
  if (!presentationType) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20">
        <div className="text-center mb-14 fade-up fade-up-1">
          <p className="font-mono text-[10px] tracking-[0.25em] text-stone-400 uppercase mb-4">New project</p>
          <h1 className="font-display text-4xl font-light text-stone-900 mb-3"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            What type of presentation?
          </h1>
          <p className="text-stone-500 text-sm max-w-md mx-auto">
            Choose the right deck for where you are in the client conversation.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto fade-up fade-up-2">
          {/* Concept Presentation */}
          <button type="button" onClick={() => setPresentationType("concept")}
            className="card p-6 text-left group hover:ring-1 hover:ring-stone-800 transition-all">
            <div className="w-10 h-10 rounded-full border border-stone-200 flex items-center justify-center mb-4 group-hover:border-stone-400 transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <path d="M12 18v-6" /><path d="M9 15l3-3 3 3" />
              </svg>
            </div>
            <p className="font-mono text-[10px] tracking-widest uppercase text-amber-600 mb-1">First meeting</p>
            <h3 className="text-lg font-medium text-stone-900 mb-2 group-hover:text-stone-700 transition-colors"
                style={{ fontFamily: "'Cormorant Garamond', serif" }}>
              Concept Presentation
            </h3>
            <p className="text-sm text-stone-500 leading-relaxed mb-4">
              Introduce the floor plan to your client with a narrative walkthrough,
              color-coded rooms, orientation highlights, and spatial comparisons.
              Designed to impress in the first meeting.
            </p>
            <span className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">
              Floor plan story · Room highlights · Sun path · Vastu
            </span>
          </button>

          {/* Interior Presentation */}
          <button type="button" onClick={() => setPresentationType("interior")}
            className="card p-6 text-left group hover:ring-1 hover:ring-stone-800 transition-all">
            <div className="w-10 h-10 rounded-full border border-stone-200 flex items-center justify-center mb-4 group-hover:border-stone-400 transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
            <p className="font-mono text-[10px] tracking-widest uppercase text-amber-600 mb-1">Design phase</p>
            <h3 className="text-lg font-medium text-stone-900 mb-2 group-hover:text-stone-700 transition-colors"
                style={{ fontFamily: "'Cormorant Garamond', serif" }}>
              Interior Presentation
            </h3>
            <p className="text-sm text-stone-500 leading-relaxed mb-4">
              Style the interiors with AI-curated moodboards — real photos
              for every room, material palettes, and a branded PDF deck
              ready to share with your client.
            </p>
            <span className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">
              Room moodboards · Style direction · Material palette
            </span>
          </button>
        </div>

        <div className="text-center mt-8">
          <a href="/dashboard" className="font-mono text-[10px] text-stone-400 hover:text-stone-600 uppercase tracking-widest transition-colors">
            ← Back to projects
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10 fade-up fade-up-1">
        <div className="flex items-center justify-between mb-8">
          <StepIndicator steps={STEPS} />
          <button type="button" onClick={() => setPresentationType(null)}
            className="font-mono text-[9px] text-stone-400 hover:text-stone-600 uppercase tracking-widest transition-colors">
            ← Change type
          </button>
        </div>
        <div className="flex items-center gap-3 mb-2">
          <span className={`font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-sm ${
            presentationType === "concept"
              ? "bg-amber-100 text-amber-700 border border-amber-200"
              : "bg-blue-50 text-blue-600 border border-blue-200"
          }`}>
            {presentationType === "concept" ? "Concept" : "Interior"}
          </span>
        </div>
        <h1 className="font-display text-4xl font-light text-stone-900 mb-2"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          New Project
        </h1>
        <p className="text-stone-500 text-sm">
          Upload a floor plan and fill in the project and site details.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* ── 1. Project details ─────────────────────────────────────────── */}
        <div className="card p-6 space-y-5 fade-up fade-up-2">
          <SectionHeader n="01" label="Project Details" />

          <div>
            <label className="field-label">Project Name *</label>
            <input className="field-input" type="text"
              placeholder="e.g. Sharma Residence, 3BHK Andheri"
              value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Client Name *</label>
              <input className="field-input" type="text"
                placeholder="e.g. Anita & Raj Sharma"
                value={clientName} onChange={(e) => setClientName(e.target.value)} required />
            </div>
            <div>
              <label className="field-label">Firm Name</label>
              <input className="field-input" type="text"
                placeholder="e.g. Studio Forma"
                value={firmName} onChange={(e) => setFirmName(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── 2. Site context ────────────────────────────────────────────── */}
        <div className="card p-6 space-y-5 fade-up fade-up-3">
          <SectionHeader n="02" label="Site Context" hint="Location helps AI recommend regionally relevant interiors" />

          {/* Location */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="field-label">City *</label>
              <input className="field-input" type="text"
                placeholder="e.g. Ludhiana"
                value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <label className="field-label">State</label>
              <input className="field-input" type="text"
                placeholder="e.g. Punjab"
                value={state_} onChange={(e) => setState_(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Country</label>
              <input className="field-input" type="text"
                value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
          </div>

          {/* Areas */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Plot / Carpet Area (sqm)</label>
              <input className="field-input" type="number" min="0" step="0.5"
                placeholder="e.g. 95"
                value={plotAreaSqm} onChange={(e) => setPlotAreaSqm(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Built-up Area (sqm)</label>
              <input className="field-input" type="number" min="0" step="0.5"
                placeholder="e.g. 110"
                value={builtUpAreaSqm} onChange={(e) => setBuiltUpAreaSqm(e.target.value)} />
            </div>
          </div>

          {/* Property type + bedrooms */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Property Type</label>
              <select className="field-input"
                value={propertyType} onChange={(e) => setPropertyType(e.target.value as PropertyType)}>
                <option value="">Select…</option>
                {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">No. of Bedrooms (BHK)</label>
              <select className="field-input"
                value={numberOfBedrooms} onChange={(e) => setNumberOfBedrooms(e.target.value)}>
                <option value="">Select…</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} BHK</option>)}
              </select>
            </div>
          </div>

          {/* Facing */}
          <div>
            <label className="field-label">Plot / Main Entrance Facing</label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {FACING_OPTIONS.map((f) => (
                <button key={f} type="button"
                  onClick={() => setFacing(facing === f ? "" : f)}
                  className={`py-2 px-1 text-center border rounded-sm transition-all font-mono text-[10px] uppercase tracking-wider
                    ${facing === f
                      ? "border-stone-900 bg-white text-stone-900"
                      : "border-stone-200 text-stone-400 hover:border-stone-400 hover:text-stone-700"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Floor location (show only for apartments/penthouse) */}
          {(propertyType === "Apartment" || propertyType === "Penthouse" || propertyType === "") && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Floor Location</label>
                <select className="field-input"
                  value={floorLocation} onChange={(e) => setFloorLocation(e.target.value as FloorLocation)}>
                  <option value="">Select…</option>
                  {FLOOR_LOCATIONS.map((f) => <option key={f} value={f}>{f} floor</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Floors in Building</label>
                <input className="field-input" type="number" min="1" max="60"
                  placeholder="e.g. 12"
                  value={numberOfFloors} onChange={(e) => setNumberOfFloors(e.target.value)} />
              </div>
            </div>
          )}

          {/* Vaastu */}
          <div className="flex items-center gap-3">
            <button type="button"
              onClick={() => setVaastuCompliance(!vaastuCompliance)}
              className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 relative ${vaastuCompliance ? "bg-stone-800" : "bg-stone-200"}`}
              role="switch" aria-checked={vaastuCompliance}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${vaastuCompliance ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
            <label className="text-sm text-stone-600 cursor-pointer select-none"
              onClick={() => setVaastuCompliance(!vaastuCompliance)}>
              Vaastu compliance is important for this project
            </label>
          </div>

          {/* Additional notes */}
          <div>
            <label className="field-label">Additional Notes</label>
            <textarea className="field-input resize-none" rows={2}
              placeholder="e.g. corner plot, irregular shape, 3m setback on north side, split-level entry…"
              value={additionalNotes} onChange={(e) => setAdditionalNotes(e.target.value)} />
            <p className="font-mono text-[10px] text-stone-400 mt-1">
              Anything else the AI should know about the plot or design intent.
            </p>
          </div>
        </div>

        {/* ── 3. Floor plan upload ───────────────────────────────────────── */}
        <div className="fade-up fade-up-4">
          <SectionHeader n="03" label="Floor Plan *" />
          <div className="mt-3">
            <div
              className={`upload-zone p-10 text-center transition-all ${dragOver ? "dragover" : ""} ${file ? "bg-white" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => !file && fileInputRef.current?.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.pdf"
                className="hidden" onChange={onFileChange} />

              {file ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-3">
                    <FileIcon type={file.type} />
                    <div className="text-left">
                      <p className="text-sm font-medium text-stone-800">{file.name}</p>
                      <p className="font-mono text-xs text-stone-400">{(file.size / 1024).toFixed(0)} KB</p>
                    </div>
                  </div>
                  <button type="button" className="btn-ghost text-stone-400 hover:text-red-500 mx-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}>
                    Remove file
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-10 h-10 border border-stone-200 rounded-sm flex items-center justify-center mx-auto">
                    <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm text-stone-600 mb-1">
                      Drop your floor plan here, or <span className="underline underline-offset-2">browse</span>
                    </p>
                    <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">
                      PNG · JPEG · PDF · Max 20 MB
                    </p>
                  </div>
                </div>
              )}
            </div>
            <p className="font-mono text-[10px] text-stone-400 mt-2 leading-relaxed">
              PDF plans with multiple floors are supported — you'll be asked which floor to proceed with on the next step.
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="border border-red-200 bg-red-50 rounded-sm px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center justify-between pt-2">
          <a href="/" className="btn-ghost">← Cancel</a>
          <button type="submit" className="btn-primary"
            disabled={uploading || !file || !name || !clientName}>
            {uploading ? (
              <><span className="spinner" /><span>Uploading…</span></>
            ) : (
              <><span>Continue to Review</span><span>→</span></>
            )}
          </button>
        </div>

      </form>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ n, label, hint }: { n: string; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xl text-stone-200">{n}</span>
        <p className="font-mono text-xs tracking-widest text-stone-500 uppercase">{label}</p>
      </div>
      {hint && <p className="font-mono text-[10px] text-stone-400 italic">{hint}</p>}
    </div>
  );
}

function FileIcon({ type }: { type: string }) {
  const label = type === "application/pdf" ? "PDF" : "IMG";
  return (
    <div className="w-10 h-10 border border-stone-200 rounded-sm flex items-center justify-center flex-shrink-0">
      <span className="font-mono text-[10px] text-stone-500 uppercase font-medium">{label}</span>
    </div>
  );
}
