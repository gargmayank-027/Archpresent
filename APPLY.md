# ArchPresent — apply this patch

Unzip at the **repo root**; paths already match and will overwrite in place.

```bash
cd /path/to/Archpresent
unzip -o ~/Downloads/archpresent-pdf-redesign.zip
git status
```

## Files

| File | Status | What |
|---|---|---|
| `lib/narrative.ts` | new | `buildRoomNarrative`, client-safe (no fs/sharp/pdf-lib) |
| `lib/pdfTheme.ts` | new | 4 style presets: surfaces + type scale |
| `lib/pdfThemeMeta.ts` | new | Picker labels only — keeps pdf-lib out of the client bundle |
| `lib/pdf.ts` | rewritten | Redesigned slides, theme-driven, + Thank You slide |
| `components/NarrativePreview.tsx` | edited | Imports from `@/lib/narrative`, not `@/lib/pdf` (fixes the build) |
| `app/api/export/preview/route.ts` | rewritten | Returns real PDF bytes; no server-side Sharp rasterization |
| `app/project/[id]/export/page.tsx` | edited | pdf.js preview; download reuses same bytes; live theme picker |

## Commit

```bash
git checkout -b feat/pdf-redesign
git add lib/narrative.ts lib/pdfTheme.ts lib/pdfThemeMeta.ts lib/pdf.ts \
        components/NarrativePreview.tsx \
        app/api/export/preview/route.ts "app/project/[id]/export/page.tsx"
git commit -m "feat: redesign PDF deck for client comprehension + wire up style presets

- fix: client component imported lib/pdf.ts, pulling fs/sharp into browser bundle
- fix: walkthrough silently dropped rooms past the first slide
- fix: presentationTheme was saved but never read by pdf.ts
- fix: undefined C.dark fell back to pure black
- preview now renders the actual PDF via pdf.js; download reuses same bytes
- raise type scale throughout; add Thank You slide"
git push origin feat/pdf-redesign
```

Includes the earlier `fix/narrative-client-bundle` change, so it applies cleanly
whether or not that branch was merged.

## Verify after deploy
1. Export page — preview shows the real deck (not an approximation).
2. Click Classic/Dark/Minimal/Warm — preview visibly changes.
3. Download — identical to preview.
4. A 12+ room plan produces multiple "Room by room" slides, no rooms missing.
