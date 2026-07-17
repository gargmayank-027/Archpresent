# ArchPresent

> Turn residential floor plans into polished client concept presentations — with your firm's branding baked in.

A Next.js 14 + TypeScript app for architecture firms. Upload a floor plan, get AI-powered room analysis, generate interior moodboards, and export a branded PDF deck with your logo, colors, and contact details.

---

## Quick start

```bash
git clone <repo> archpresent && cd archpresent
npm install
cp .env.local.example .env.local
npm run dev
# → http://localhost:3000
```

No API keys needed — stubs produce realistic fake data immediately.

---

## First-time setup

1. Go to **Settings** (`/settings`) and fill in your firm profile once:
   - Firm name, tagline, logo (PNG/SVG)
   - PDF accent colour (6 options) and typography style
   - Contact details (email, phone, address, website)
2. These are saved to `.archpresent-firm.json` and applied automatically to every project.
3. The amber dot on the Settings nav link disappears once you've saved a profile.

---

## Folder structure

```
archpresent/
├── app/
│   ├── layout.tsx                   # Root layout — imports NavBar
│   ├── page.tsx                     # Home dashboard — projects grid + stats
│   ├── globals.css                  # Tailwind base + custom design tokens
│   ├── settings/
│   │   └── page.tsx                 # ★ Firm profile settings (3 tabs)
│   ├── project/
│   │   ├── new/
│   │   │   └── page.tsx             # Screen 1: Create project + upload plan
│   │   └── [id]/
│   │       ├── page.tsx             # Smart redirect → correct step
│   │       ├── review/page.tsx      # Screen 2: Plan review + AI analysis
│   │       ├── moodboards/page.tsx  # Screen 3: Style form + moodboards
│   │       └── export/page.tsx      # Screen 4: Summary + PDF export
│   └── api/
│       ├── firm/route.ts            # ★ GET/POST firm profile
│       ├── projects/route.ts        # POST create, GET list
│       ├── projects/[id]/route.ts   # GET single project
│       ├── analyze/route.ts         # POST run analysis / save edits
│       ├── moodboards/route.ts      # POST generate, PATCH replace
│       └── export/route.ts          # POST → PDF download
│
├── components/
│   ├── NavBar.tsx                   # ★ Firm-aware nav with logo + settings nudge
│   └── StepIndicator.tsx            # 4-step progress bar
│
├── lib/
│   ├── ai.ts                        # AI stubs (analyzePlanImage, generatePlanStrengths, generateMoodboardImage)
│   ├── pdf.ts                       # ★ Firm-branded PDF (logo, accent, contact footer)
│   └── store.ts                     # ★ Projects + firm profile persistence
│
├── types/index.ts                   # All TypeScript interfaces incl. FirmProfile
└── public/uploads/                  # Uploaded files (gitignored)
```

★ = added/updated in firm profile feature

---

## User flow

| Step | Route | What happens |
|------|-------|-------------|
| 0 | `/settings` | **One-time**: enter firm name, logo, PDF style, contact |
| 1 | `/project/new` | Enter project/client details, site context (BHK, facing, area, Vaastu), upload floor plan |
| 2 | `/project/[id]/review` | View plan + site context panel; click Analyse → AI detects rooms + drafts strengths; edit bullets |
| 3 | `/project/[id]/moodboards` | Style questionnaire → AI generates moodboards per key room; regenerate per room |
| 4 | `/project/[id]/export` | Review full summary → export PDF with firm branding |

---

## Firm Profile — what it controls

| Setting | Where it appears |
|---------|-----------------|
| Firm name | Nav bar, PDF cover, PDF footer |
| Logo (PNG/JPG/SVG) | Nav bar, PDF cover top-right |
| Tagline | PDF footer |
| Cover tagline | PDF cover — large decorative phrase |
| Accent colour | PDF sidebar stripe, page headings, compass rose pointer |
| Typography style | PDF heading/body font choice |
| Email / Phone / Website | PDF footer every page |
| Address | PDF footer |

Firm profile is saved to `.archpresent-firm.json` (excluded from git). To reset, use the Danger Zone in Settings.

---

## FirmProfile type

```typescript
interface FirmProfile {
  name: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoUrl?: string;          // /uploads/firm-logo.png
  logoDiskPath?: string;     // absolute path for PDF embedding
  accentColor: PdfAccentColor;  // graphite | navy | forest | terracotta | slate | plum
  fontStyle: PdfFontStyle;      // editorial | modern | classic
  coverTagline?: string;
  updatedAt: string;
}
```

---

## AI integration (3 stubs → real)

All AI logic in `lib/ai.ts`. Function signatures are stable — replace bodies only:

```typescript
analyzePlanImage(planImageUrl, plotInfo?)  → PlanAnalysis
generatePlanStrengths(analysis, plotInfo?) → string[]
generateMoodboardImage(room, style)        → string (image URL)
```

`plotInfo` is passed through to all analysis calls, giving the LLM full site context (facing, BHK, area, Vaastu, notes).

`buildMoodboardPrompt(room, style)` and `buildPlotContext(plotInfo)` are ready-made prompt builders — wire them into your real API calls.

---

## PDF deck pages

1. **Cover** — firm logo top-right, project name large, client name, date, plot tag line (BHK · facing · area), firm cover tagline, accent bottom bar
2. **Site Context** *(if plotInfo present)* — two-column table + compass rose with facing direction highlighted
3. **Floor Plan** — full-bleed plan image, room count + total area
4. **Plan Strengths** — numbered editorial bullets
5+. **Moodboard pages** — one per generated room (image + label)

All pages: branded footer with firm name, tagline, contact details, page numbers.

---

## npm packages

```bash
npm install next@14 react react-dom pdf-lib
npm install -D typescript @types/node @types/react @types/react-dom tailwindcss postcss autoprefixer eslint eslint-config-next
```

For real AI:
```bash
npm install openai              # GPT-4o analysis + DALL-E moodboards
npm install @anthropic-ai/sdk   # Claude analysis
npm install replicate           # FLUX moodboard images
npm install @aws-sdk/client-s3  # S3 file storage
```

---

## Environment variables

```bash
APP_URL=http://localhost:3000   # Used to build absolute image URLs for AI vision calls

# AI (plug in when ready)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
REPLICATE_API_TOKEN=r8_...

# CAD import (see cad_service/README.md)
CAD_SERVICE_PYTHON_BIN=python3   # optional — override if python3 isn't on PATH
```

---

## CAD import (DXF)

`/project/new` also accepts `.dxf` files alongside PNG/JPEG/PDF. This is a
second, parallel upload path — the image-upload flow described above is
completely unaffected by it. See `archpresent-cad-migration-plan.md` for
the full rationale and `cad_service/README.md` for how the Python renderer
itself works.

**Requirements:** `python3` must be on the server's `PATH`. No `pip install`
is required — the V1 MVP implementation is standard-library-only (see
`cad_service/README.md` for why, and the production upgrade path to
`ezdxf`/`pydantic`/`shapely`/`fastapi`).

```
app/api/cad/upload/route.ts   — POST: parse a DXF, create a Project
app/api/cad/render/route.ts   — POST: re-render an existing CAD project under a new theme
app/api/cad/themes/route.ts   — GET: theme picker metadata
lib/cadClient.ts              — Node <-> Python bridge (child_process today, HTTP later)
cad_service/                  — the Python renderer itself (parse -> classify -> map -> render)
components/CadThemePicker.tsx — theme picker UI
components/CadPlanReview.tsx  — CAD-specific review-page UI
```

A CAD-origin `Project` gets `sourceType: "cad"` and is otherwise a normal
`Project` — PDF export, sharing, feedback, and moodboards all work
unchanged, because the CAD pipeline populates exactly the same
`renderedPlanUrl` / `analysis.rooms[]` contract the image pipeline does,
just from real geometry instead of an AI guess.

Try it locally:
```bash
python3 -m unittest discover cad_service/tests   # Python side, no deps needed
python3 cad_service/cli.py cad_service/fixtures/sample_apartment.dxf --theme modern --out /tmp/cad_out
```

