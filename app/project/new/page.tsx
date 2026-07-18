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

  // ── Client brief ──────────────────────────────────────────────────────────
  const [familySize, setFamilySize]         = useState<number>(0);
  const [familyTags, setFamilyTags]         = useState<string[]>([]);
  const [lifestyleTags, setLifestyleTags]   = useState<string[]>([]);
  const [priorityTags, setPriorityTags]     = useState<string[]>([]);
  const [showVastu, setShowVastu]           = useState(false);
  const [additionalBrief, setAdditionalBrief] = useState("");

  function toggleTag(arr: string[], setArr: (v: string[]) => void, tag: string) {
    setArr(arr.includes(tag) ? arr.filter(t => t !== tag) : [...arr, tag]);
  }

  // Build brief strings from tags for submission
  const familyDetails = [
    familySize ? `Family of ${familySize}` : "",
    ...familyTags,
  ].filter(Boolean).join(", ");

  const lifestyle = lifestyleTags.join(", ");
  const priorities = priorityTags.join(", ");

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
  const [cadUnitOverride, setCadUnitOverride] = useState<string>(""); // "" = trust the file's own $INSUNITS
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const STEPS = [
    { num: "1", label: "Upload",     status: "active"  as const },
    { num: "2", label: "Review",     status: "pending" as const },
    { num: "3", label: "Moodboards", status: "pending" as const },
    { num: "4", label: "Export",     status: "pending" as const },
  ];

  function isCadFile(f: File): boolean {
    // DXF has no consistent browser-reported MIME type (often "" or
    // "application/octet-stream"), so this is extension-based — same
    // approach the migration plan calls for (§2.1: "file extension check
    // at the moment of upload").
    return f.name.toLowerCase().endsWith(".dxf");
  }

  function handleFileSelect(f: File) {
    const allowedImageTypes = ["image/png", "image/jpeg", "application/pdf"];
    if (!allowedImageTypes.includes(f.type) && !isCadFile(f)) {
      setError("Please upload a PNG, JPEG, PDF, or DXF file.");
      return;
    }
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

    // ── CAD path: post directly to /api/cad/upload and skip everything
    //    below (PDF rasterization, /api/projects) entirely. This branch
    //    is fully separate from the image/PDF path — see migration plan §4.
    if (isCadFile(file)) {
      try {
        const fd = new FormData();
        fd.append("name",       name.trim());
        fd.append("clientName", clientName.trim());
        fd.append("firmName",   firmName.trim() || "Architecture Studio");
        if (presentationType) fd.append("presentationType", presentationType);
        fd.append("plan", file);

        if (city.trim())        fd.append("city",           city.trim());
        if (state_.trim())      fd.append("state",          state_.trim());
        if (country.trim())     fd.append("country",        country.trim());
        if (familyDetails.trim()) fd.append("familyDetails", familyDetails.trim());
        if (lifestyle.trim())   fd.append("lifestyle",      lifestyle.trim());
        if (priorities.trim())  fd.append("priorities",     priorities.trim());
        if (showVastu)          fd.append("showVastu",      "true");
        if (facing)           fd.append("facing",           facing);
        if (propertyType)     fd.append("propertyType",     propertyType);
        if (floorLocation)    fd.append("floorLocation",    floorLocation);
        if (cadUnitOverride)  fd.append("unitOverride",      cadUnitOverride);

        const res  = await fetch("/api/cad/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "CAD upload failed"); return; }
        router.push(`/project/${data.project.id}/review`);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setUploading(false);
      }
      return;
    }

    try {
      // If the file is a PDF, rasterize it to PNG client-side BEFORE uploading.
      // This guarantees the server always receives a raster image, avoiding the
      // entire chain of server-side PDF handling issues (Sharp can't decode PDFs
      // on Vercel, pdfjs-dist + @napi-rs/canvas can't run serverless, etc.)
      let uploadFile: File = file;

      if (file.type === "application/pdf") {
        setError(null);
        try {
          const pdfjsLib = await import("pdfjs-dist");
          pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

          const pdfData = new Uint8Array(await file.arrayBuffer());
          const doc = await pdfjsLib.getDocument({ data: pdfData }).promise;

          if (doc.numPages > 1) {
            // Multi-page PDF — let the server split it, the review page
            // will show the floor picker. Pass the original PDF through.
            doc.destroy();
          } else {
            // Single-page PDF — render to PNG right here so the server
            // never has to deal with PDF-to-image conversion.
            const page = await doc.getPage(1);
            const viewport = page.getViewport({ scale: 3 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;

            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob(
                (b) => b ? resolve(b) : reject(new Error("Canvas conversion failed")),
                "image/png"
              );
            });

            uploadFile = new File([blob], file.name.replace(/\.pdf$/i, ".png"), {
              type: "image/png",
            });

            doc.destroy();
          }
        } catch (pdfErr) {
          console.error("Client-side PDF rendering failed:", pdfErr);
          // Fall through — let the server handle it (may fail, but better than blocking)
        }
      }

      const fd = new FormData();
      fd.append("name",       name.trim());
      fd.append("clientName", clientName.trim());
      fd.append("firmName",   firmName.trim() || "Architecture Studio");
      if (presentationType) fd.append("presentationType", presentationType);
      fd.append("plan",       uploadFile);

      // Site context — only append if filled in
      if (city.trim())        fd.append("city",           city.trim());
      if (state_.trim())      fd.append("state",          state_.trim());
      if (country.trim())     fd.append("country",        country.trim());
      if (familyDetails.trim()) fd.append("familyDetails", familyDetails.trim());
      if (lifestyle.trim())   fd.append("lifestyle",      lifestyle.trim());
      if (priorities.trim())  fd.append("priorities",     priorities.trim());
      if (additionalBrief.trim()) fd.append("additionalNotes", additionalBrief.trim());
      if (showVastu)          fd.append("showVastu",      "true");
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

          {/* Client brief — only for concept presentations */}
          {presentationType === "concept" && (
            <>
              <div className="pt-2 border-t border-stone-100">
                <p className="font-mono text-[9px] text-amber-600 uppercase tracking-widest mb-3">Client Brief</p>
                <p className="text-[11px] text-stone-400 mb-3">
                  Tell us about the client — this personalises the presentation.
                </p>
              </div>

              {/* Family size */}
              <div>
                <label className="field-label">Family Size</label>
                <div className="flex gap-2 flex-wrap">
                  {[2, 3, 4, 5, 6, 7].map(n => (
                    <button key={n} type="button" onClick={() => setFamilySize(familySize === n ? 0 : n)}
                      className={`px-4 py-2 rounded-sm border text-sm transition-all ${
                        familySize === n
                          ? "bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100"
                          : "border-stone-200 text-stone-600 hover:border-stone-400"
                      }`}>
                      {n} {n === 7 ? "+" : ""}
                    </button>
                  ))}
                </div>
              </div>

              {/* Family composition */}
              <div>
                <label className="field-label">Who lives here?</label>
                <div className="flex gap-2 flex-wrap">
                  {["Young kids", "Teenagers", "Elderly parents", "Live-in help", "Pets", "Guests often"].map(tag => (
                    <button key={tag} type="button" onClick={() => toggleTag(familyTags, setFamilyTags, tag)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                        familyTags.includes(tag)
                          ? "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300"
                          : "border-stone-200 text-stone-500 hover:border-stone-400"
                      }`}>
                      {familyTags.includes(tag) ? "✓ " : ""}{tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lifestyle */}
              <div>
                <label className="field-label">Lifestyle</label>
                <div className="flex gap-2 flex-wrap">
                  {["Works from home", "Loves cooking", "Hosts often", "Fitness/Yoga", "Gardening", "Reading/Study", "Movie nights", "Joint family meals"].map(tag => (
                    <button key={tag} type="button" onClick={() => toggleTag(lifestyleTags, setLifestyleTags, tag)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                        lifestyleTags.includes(tag)
                          ? "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300"
                          : "border-stone-200 text-stone-500 hover:border-stone-400"
                      }`}>
                      {lifestyleTags.includes(tag) ? "✓ " : ""}{tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Priorities */}
              <div>
                <label className="field-label">What matters most?</label>
                <div className="flex gap-2 flex-wrap">
                  {["Privacy", "Natural light", "Open plan", "Low maintenance", "Large kitchen", "Outdoor space", "Car parking", "Future expansion", "Separate entry"].map(tag => (
                    <button key={tag} type="button" onClick={() => toggleTag(priorityTags, setPriorityTags, tag)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                        priorityTags.includes(tag)
                          ? "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300"
                          : "border-stone-200 text-stone-500 hover:border-stone-400"
                      }`}>
                      {priorityTags.includes(tag) ? "✓ " : ""}{tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Vastu toggle */}
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setShowVastu(!showVastu)}
                  className={`px-4 py-2 rounded-sm border text-sm transition-all flex items-center gap-2 ${
                    showVastu
                      ? "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300"
                      : "border-stone-200 text-stone-500 hover:border-stone-400"
                  }`}>
                  {showVastu ? "✓" : "○"} Vastu compliance analysis
                </button>
              </div>

              {/* Additional notes */}
              <div>
                <label className="field-label">Anything else? <span className="text-stone-400 font-normal">(optional)</span></label>
                <input className="field-input" type="text"
                  placeholder="e.g. Corner plot, wants a basement, prefers marble flooring"
                  value={additionalBrief} onChange={(e) => setAdditionalBrief(e.target.value)} />
              </div>
            </>
          )}

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

          {/* Property type */}
          <div>
            <label className="field-label">Property Type</label>
            <div className="flex gap-2 flex-wrap mt-1">
              {PROPERTY_TYPES.map((t) => (
                <button key={t} type="button"
                  onClick={() => setPropertyType(propertyType === t ? "" as PropertyType : t)}
                  className={`px-3 py-2 rounded-sm border text-xs transition-all ${
                    propertyType === t
                      ? "bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100"
                      : "border-stone-200 text-stone-600 hover:border-stone-400"
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Bedrooms */}
          <div>
            <label className="field-label">Bedrooms (BHK)</label>
            <div className="flex gap-2 mt-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button"
                  onClick={() => setNumberOfBedrooms(numberOfBedrooms === String(n) ? "" : String(n))}
                  className={`w-14 py-2 rounded-sm border text-sm text-center transition-all ${
                    numberOfBedrooms === String(n)
                      ? "bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100"
                      : "border-stone-200 text-stone-600 hover:border-stone-400"
                  }`}>
                  {n}
                </button>
              ))}
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
                      ? "bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100"
                      : "border-stone-200 text-stone-400 hover:border-stone-400 hover:text-stone-700"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Floor location (show only for apartments/penthouse) */}
          {(propertyType === "Apartment" || propertyType === "Penthouse") && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Floor Location</label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {FLOOR_LOCATIONS.map((f) => (
                    <button key={f} type="button"
                      onClick={() => setFloorLocation(floorLocation === f ? "" as FloorLocation : f)}
                      className={`px-3 py-1.5 rounded-sm border text-xs transition-all ${
                        floorLocation === f
                          ? "bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100"
                          : "border-stone-200 text-stone-500 hover:border-stone-400"
                      }`}>
                      {f}
                    </button>
                  ))}
                </div>
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
              <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.pdf,.dxf"
                className="hidden" onChange={onFileChange} />

              {file ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-3">
                    <FileIcon type={file.type} name={file.name} />
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

                  {isCadFile(file) && (
                    <div className="pt-2 border-t border-stone-100 text-left max-w-xs mx-auto"
                         onClick={(e) => e.stopPropagation()}>
                      <label className="font-mono text-[9px] uppercase tracking-widest text-stone-400 block mb-1.5">
                        Drawing units (optional)
                      </label>
                      <select
                        value={cadUnitOverride}
                        onChange={(e) => setCadUnitOverride(e.target.value)}
                        className="w-full text-xs border border-stone-200 rounded-sm px-2 py-1.5 bg-white text-stone-700"
                      >
                        <option value="">Auto-detect from file (default)</option>
                        <option value="mm">Millimeters</option>
                        <option value="cm">Centimeters</option>
                        <option value="m">Meters</option>
                        <option value="in">Inches</option>
                        <option value="ft">Feet</option>
                      </select>
                      <p className="font-mono text-[9px] text-stone-400 mt-1 leading-relaxed">
                        Only change this if room sizes come out obviously wrong — some files'
                        internal units don't match what their header declares.
                      </p>
                    </div>
                  )}
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
                      PNG · JPEG · PDF · DXF · Max 20 MB
                    </p>
                  </div>
                </div>
              )}
            </div>
            <p className="font-mono text-[10px] text-stone-400 mt-2 leading-relaxed">
              PDF plans with multiple floors are supported — you'll be asked which floor to proceed with on the next step.
              DXF files are parsed exactly as drawn — walls, rooms, and furniture are never moved or redesigned.
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
              <><span className="spinner" /><span>{
                file?.name.toLowerCase().endsWith(".dxf") ? "Processing CAD file…"
                  : file?.type === "application/pdf" ? "Processing PDF…"
                  : "Uploading…"
              }</span></>
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

function FileIcon({ type, name }: { type: string; name?: string }) {
  const label = name?.toLowerCase().endsWith(".dxf") ? "CAD" : type === "application/pdf" ? "PDF" : "IMG";
  return (
    <div className="w-10 h-10 border border-stone-200 rounded-sm flex items-center justify-center flex-shrink-0">
      <span className="font-mono text-[10px] text-stone-500 uppercase font-medium">{label}</span>
    </div>
  );
}
