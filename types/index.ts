// ─── Core Domain Types ────────────────────────────────────────────────────────

export type PlotFacing = "North" | "South" | "East" | "West" | "North-East" | "North-West" | "South-East" | "South-West";

export type PropertyType = "Apartment" | "Independent House" | "Villa" | "Penthouse" | "Studio";

export type FloorLocation = "Ground" | "Lower" | "Mid" | "Top" | "Duplex";

export interface PlotInfo {
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

export interface Project {
  id: string;
  name: string;
  clientName: string;
  firmName: string;
  createdAt: string;
  planImageUrl: string; // relative URL served from /uploads/
  planImagePath: string; // absolute disk path (for PDF generation)
  originalPlanImageUrl?: string;  // pre-enhancement version
  enhancementNotes?: string[];    // what Sharp did to the image
  plotInfo?: PlotInfo;  // site context captured at upload time
  analysis?: PlanAnalysis;
  planStrengths?: string[];
  styleProfile?: StyleProfile;
  moodboards?: Moodboard[];
  status: "created" | "analyzed" | "styled" | "complete";
}

export interface RoomSummary {
  name: string; // e.g. "Living Room", "Kitchen", "Bedroom 1"
  sizeEstimateSqm?: number;
  notes?: string;
}

export interface PlanAnalysis {
  rooms: RoomSummary[];
  hasBalcony?: boolean;
  hasClearZoning?: boolean;
  totalAreaSqm?: number;
  comments?: string[];
}

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

export interface Moodboard {
  roomName: string;
  imageUrl: string; // URL served from /uploads/ or external placeholder
  prompt?: string; // the prompt used to generate it (for regeneration)
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

export interface RoomDetail extends RoomSummary {
  windowCount?: number;        // estimated windows / natural light openings
  orientation?: string;        // "north-facing", "corner unit" etc.
  adjacentRooms?: string[];    // rooms it connects to
  specialFeatures?: string[];  // "walk-in wardrobe", "attached bath", "double height"
  furnitureHints?: string[];   // furniture visible in plan: "L-sofa", "island counter"
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
