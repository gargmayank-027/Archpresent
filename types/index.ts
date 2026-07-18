// ─── Core Domain Types ────────────────────────────────────────────────────────

export type PlotFacing = "North" | "South" | "East" | "West" | "North-East" | "North-West" | "South-East" | "South-West";

export type PropertyType = "Apartment" | "Independent House" | "Villa" | "Penthouse" | "Studio";

export type FloorLocation = "Ground" | "Lower" | "Mid" | "Top" | "Duplex";

export interface PlotInfo {
  // Location context — drives image search and style recommendations
  city?: string;              // e.g. "Ludhiana", "Bengaluru", "Jaipur"
  state?: string;             // e.g. "Punjab", "Karnataka", "Rajasthan"
  country?: string;           // defaults to "India" if not specified
  climateZone?: ClimateZone;  // hot-dry, warm-humid, composite, cold, temperate

  // Client brief — captured during project setup
  familySize?: number;          // e.g. 4 (couple + 2 kids)
  familyDetails?: string;       // e.g. "Couple, 2 school-age kids, elderly parents"
  lifestyle?: string;           // e.g. "Work from home, loves cooking, hosts often"
  priorities?: string;          // e.g. "Privacy, natural light, low maintenance"
  budgetRange?: string;         // e.g. "60-80 lakhs"
  showVastu?: boolean;          // client wants Vastu analysis? (default: false)

  plotAreaSqm?: number;           // total plot / carpet area in sqm
  builtUpAreaSqm?: number;        // built-up / super built-up area in sqm
  facing?: PlotFacing;            // main entrance / plot facing direction
  propertyType?: PropertyType;    // apartment, villa, house, etc.
  numberOfBedrooms?: number;      // 1BHK, 2BHK, 3BHK …
  numberOfFloors?: number;        // floors in building (for independent houses/villas)
  floorLocation?: FloorLocation;  // which floor the unit is on
  vaastuCompliance?: boolean;     // client wants Vaastu considered?
  additionalNotes?: string;       // free-text: corner plot, irregular shape, setbacks, etc.
}

export type ClimateZone = "hot-dry" | "warm-humid" | "composite" | "cold" | "temperate";

export interface PlanPage {
  pageNumber: number;   // 1-indexed, matches the page's position in the source PDF
  imageUrl: string;     // relative URL served from /uploads/
  imagePath: string;    // absolute disk path
  label?: string;       // e.g. "Ground Floor" — user-editable once we can infer/name it
}

export interface Project {
  id: string;
  userId?: string;  // owner — projects are scoped per user
  presentationType?: "concept" | "interior";  // concept = first-meeting intro, interior = moodboard deck
  name: string;
  clientName: string;
  firmName: string;
  createdAt: string;
  planImageUrl: string; // relative URL served from /uploads/ — the ACTIVE floor plan
  planImagePath: string; // absolute disk path (for PDF generation) — the ACTIVE floor plan
  originalPlanImageUrl?: string;  // pre-enhancement version
  renderedPlanUrl?: string;       // color-coded plan with room overlays
  aiRenderedPlanUrl?: string;     // photorealistic AI-rendered plan (via Replicate ControlNet)
  enhancementNotes?: string[];    // what Sharp did to the image
  planPages?: PlanPage[];             // all pages, populated when the upload was a multi-page PDF
  selectedPageIndex?: number;         // which planPages[] entry is currently active (0-indexed)
  floorSelectionConfirmed?: boolean;  // true once the architect has explicitly picked a floor
                                       // (always true for single-page uploads — nothing to pick)
  plotInfo?: PlotInfo;  // site context captured at upload time
  analysis?: PlanAnalysis;
  planStrengths?: string[];
  styleProfile?: StyleProfile;
  moodboards?: Moodboard[];           // legacy single-image (kept for compat)
  overallMoodboard?: OverallMoodboard; // whole-home style collage
  roomMoodboards?: RoomMoodboard[];    // per-room: plan snippet + 3-4 images
  status: "created" | "analyzed" | "styled" | "complete";

  // Shareable client link
  shareToken?:     string;   // random slug used in /share/[token]
  shareEnabled?:   boolean;  // false = link disabled even if token exists
  shareExpiresAt?: string;   // ISO string, undefined = never expires
  shareViewCount?: number;   // how many times the link was opened
  shareLastViewedAt?: string; // ISO timestamp of last view

  // Client feedback from the shared presentation viewer
  clientFeedback?: {
    id: string;
    clientName: string;
    reaction: "love" | "like" | "neutral" | "concern" | null;
    comment: string | null;
    slideIndex: number | null;
    createdAt: string;
  }[];

  // Presentation visual theme
  presentationTheme?: "classic" | "dark" | "minimal" | "warm";

  // Editable room narratives for the walkthrough slide
  // Keys are room names, values are the architect-edited narrative text
  roomNarratives?: Record<string, string>;

  // Plan strengths can be edited too
  editedStrengths?: string[];

  // ─── CAD import (additive — see archpresent-cad-migration-plan.md) ───────
  // Every field below is optional. Existing image-origin projects simply
  // never set them, and every existing consumer of `Project` that doesn't
  // know about these fields keeps compiling and behaving exactly as before.
  sourceType?: "image" | "cad";     // undefined is treated as "image" (legacy default)
  cadFileUrl?: string;              // stored original .dxf/.dwg, needed to re-render on theme change
  cadTheme?: string;                // the PLAN's own theme (modern/luxury/...) — distinct from
                                     // presentationTheme, which styles the PDF/share deck (see
                                     // design-system.md §2: these two theming axes must stay decoupled)
  cadIrUrl?: string;                // stored FloorPlanIR JSON, for audit / future re-render / V2
  cadWarnings?: { code: string; message: string; severity: "info" | "warning" }[];
  cadUnitOverride?: string;         // "mm" | "cm" | "m" | "in" | "ft" — see renderer_service/app/services/units.py.
                                     // Undefined/omitted means "trust the file's own $INSUNITS header".
  cadBlockOverrides?: Record<string, string>; // raw CAD block name -> furniture category, accumulated
                                               // across re-renders so a firm's mapping choices persist.
  cadUnmappedBlockNames?: string[]; // block names that still fell back to the generic symbol on the
                                     // most recent render — drives components/CadBlockMappingPanel.tsx.
}

export interface RoomSummary {
  name: string; // e.g. "Living Room", "Kitchen", "Bedroom 1"
  sizeEstimateSqm?: number;
  notes?: string;
}

// PlanAnalysis is defined below after RoomDetail (which it references)

export type OverallStyle =
  | "Modern"
  | "Contemporary"
  | "Scandinavian"
  | "Minimal"
  | "Industrial"
  | "Classic";

export type Palette = "LightAiry" | "NeutralWarm" | "DarkMoody";

export type BudgetVibe = "Practical" | "MidRange" | "Premium";

export interface StyleProfile {
  overallStyle: OverallStyle;
  palette: Palette;
  budgetVibe: BudgetVibe;
  hardNo: string;
}

export interface MoodImage {
  url: string;              // image URL
  caption?: string;         // e.g. "Seating area", "Dining zone"
  source: "unsplash" | "ai";        // real photo (Unsplash search) vs AI-generated
  sourceUrl?: string;       // link back to original Unsplash photo page (credit/buy reference)
  photographer?: string;    // Unsplash photographer name, for attribution
  photographerUrl?: string; // Unsplash photographer profile link
}

export interface RoomMoodboard {
  roomName: string;
  planSnippetUrl?: string;    // cropped portion of the floor plan for this room
  images: MoodImage[];        // 3-4 mood images for this space
  contextPrompt?: string;     // architect's plain-English brief for this room
}

export interface OverallMoodboard {
  images: MoodImage[];        // 4-image hero collage for whole-home style
  styleStatement: string;     // one sentence describing the overall look
}

// Legacy — kept for backward compat with PDF, replaced by RoomMoodboard[]
export interface Moodboard {
  roomName: string;
  imageUrl: string;
  prompt?: string;
}

// ─── API Request / Response Shapes ───────────────────────────────────────────

export interface CreateProjectRequest {
  name: string;
  clientName: string;
  firmName: string;
}

export interface CreateProjectResponse {
  project: Project;
}

export interface AnalyzeResponse {
  analysis: PlanAnalysis;
  strengths: string[];
}

export interface MoodboardsRequest {
  projectId: string;
  rooms: string[]; // room names to generate for
}

export interface MoodboardsResponse {
  moodboards: Moodboard[];
}

export interface ExportRequest {
  projectId: string;
}

// ─── AI Interface Contracts ───────────────────────────────────────────────────
// These are the function signatures real AI integrations must implement.

export interface AIAdapter {
  analyzePlanImage(planImageUrl: string, plotInfo?: PlotInfo): Promise<PlanAnalysis>;
  generatePlanStrengths(analysis: PlanAnalysis, plotInfo?: PlotInfo): Promise<string[]>;
  generateMoodboardImage(
    room: RoomSummary,
    style: StyleProfile
  ): Promise<string>;
}

// ─── Storage Interface ────────────────────────────────────────────────────────
// Swap implementation for DB-backed store later.

export interface ProjectStore {
  create(project: Project): Promise<Project>;
  get(id: string): Promise<Project | null>;
  update(id: string, patch: Partial<Project>): Promise<Project>;
  list(): Promise<Project[]>;
  delete(id: string): Promise<void>;
}

// ─── Firm Profile ─────────────────────────────────────────────────────────────
// Saved once per installation. All projects inherit these defaults.

export type PdfAccentColor =
  | "graphite"   // #2d2b27 — default dark
  | "navy"       // #1a2744
  | "forest"     // #1a3a2a
  | "terracotta" // #8b3a1e
  | "slate"      // #2a3540
  | "plum";      // #3a1a44

export type PdfFontStyle =
  | "editorial"   // Cormorant Garamond — current default
  | "modern"      // Helvetica only — clean Swiss
  | "classic";    // Times-like — traditional

export interface FirmProfile {
  name: string;                   // "Studio Forma"
  tagline?: string;               // "Architecture & Interiors"
  address?: string;               // "12 MG Road, Bengaluru 560001"
  phone?: string;                 // "+91 98765 43210"
  email?: string;                 // "hello@studioforma.in"
  website?: string;               // "www.studioforma.in"
  logoUrl?: string;               // /uploads/firm-logo.png
  logoDiskPath?: string;          // absolute path for PDF embedding
  accentColor: PdfAccentColor;    // PDF sidebar + heading color
  fontStyle: PdfFontStyle;        // PDF typography personality
  coverTagline?: string;          // shown on PDF cover, e.g. "Where Space Meets Story"
  updatedAt: string;
}

export interface FirmStore {
  get(): Promise<FirmProfile | null>;
  set(profile: FirmProfile): Promise<FirmProfile>;
}

// ─── Image enhancement ────────────────────────────────────────────────────────

export interface EnhancedPlan {
  originalUrl: string;
  enhancedUrl: string;
  enhancedDiskPath: string;
  processingNotes: string[];  // what was done: "contrast boost", "sharpened", etc.
}

// ─── Extended RoomSummary with spatial detail ─────────────────────────────────
// Populated by the vision LLM — used to build better moodboard prompts.

export interface RoomBoundingBox {
  // Normalised 0-1 coordinates relative to plan image dimensions.
  // Origin (0,0) is top-left. Populated by vision AI room-detection pass
  // (not yet implemented) or by manual user adjustment in future.
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomDetail extends RoomSummary {
  windowCount?: number;        // estimated windows / natural light openings
  orientation?: string;        // "north-facing", "corner unit" etc.
  adjacentRooms?: string[];    // rooms it connects to
  specialFeatures?: string[];  // "walk-in wardrobe", "attached bath", "double height"
  furnitureHints?: string[];   // furniture visible in plan: "L-sofa", "island counter"
  moodboardWorthy?: boolean;   // true for spaces with interior design potential
  boundingBox?: RoomBoundingBox; // real plan coordinates — vision-AI-guessed for image-origin
                                  // projects, EXACT (from CAD geometry) for CAD-origin projects.
                                  // Same field, same shape, either way — see renderer_service/app/services/render_pipeline.py.

  // ─── CAD import (additive) ────────────────────────────────────────────
  roomType?: string;                    // deterministic room_type key from the CAD classifier
  classificationConfidence?: number;    // 0-1, from renderer_service/app/services/room_classifier.py
}

// Extend PlanAnalysis to carry room detail
export interface PlanAnalysis {
  rooms: RoomDetail[];         // upgraded from RoomSummary[]
  hasBalcony?: boolean;
  hasClearZoning?: boolean;
  totalAreaSqm?: number;
  comments?: string[];
  lightningSide?: string;      // which side gets most light based on facing
  circulationQuality?: "tight" | "comfortable" | "generous";
}
