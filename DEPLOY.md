# Deploying ArchPresent to Vercel

## Prerequisites
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- A Vercel account (free tier works)

---

## Step 1 — Install dependencies

```bash
npm install
```

---

## Step 2 — Link to Vercel

```bash
vercel link
```
Follow the prompts. Creates a `.vercel` folder.

---

## Step 3 — Create storage (one-time)

```bash
# KV store — for project and firm profile data
vercel storage create kv --name archpresent-kv

# Blob store — for file uploads (plans, logos, moodboards)
vercel storage create blob --name archpresent-blob
```

Both are **free tier** on Vercel:
- KV: 256MB storage, 3,000 req/day free
- Blob: 500MB storage, 1GB transfer free

---

## Step 4 — Pull env variables

```bash
vercel env pull .env.local
```

This writes `BLOB_READ_WRITE_TOKEN`, `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` to your `.env.local`.

---

## Step 5 — Add your AI keys

Open `.env.local` and add:

```bash
# Free — get at aistudio.google.com/apikey
GOOGLE_AI_KEY=AIzaSy...

# Free — get at huggingface.co → Settings → Access Tokens
HF_TOKEN=hf_...
```

---

## Step 6 — Deploy

```bash
vercel deploy --prod
```

First deploy takes ~2 minutes. Subsequent deploys are faster.

---

## Step 7 — Set env vars in Vercel dashboard

The AI keys need to be added to Vercel's environment too:

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard) → your project → Settings → Environment Variables
2. Add:
   - `GOOGLE_AI_KEY` = your Gemini key
   - `HF_TOKEN` = your HuggingFace token
   - `APP_URL` = your Vercel deployment URL (e.g. `https://archpresent.vercel.app`)

Or use the CLI:
```bash
vercel env add GOOGLE_AI_KEY
vercel env add HF_TOKEN
vercel env add APP_URL
```

Then redeploy:
```bash
vercel deploy --prod
```

---

## How storage works on Vercel

| What | Local dev | Vercel prod |
|------|-----------|-------------|
| Project data | `.archpresent-data.json` | Vercel KV (Redis) |
| Firm profile | `.archpresent-firm.json` | Vercel KV (Redis) |
| Uploaded plans | `public/uploads/` | Vercel Blob |
| Generated moodboards | `public/uploads/` | Vercel Blob |
| Plan snippets | `public/uploads/` | Vercel Blob |

The app detects which mode it's in via `BLOB_READ_WRITE_TOKEN`. If the token is present → Vercel mode. If not → local mode. No code changes needed.

---

## Troubleshooting

**Build fails with "Cannot find module 'sharp'"**
Sharp's native binaries aren't available on all Vercel runtimes. The app handles this gracefully — plan enhancement will be skipped but everything else works. This is expected.

**"KV_URL is not defined" error**
You need to run `vercel env pull .env.local` after creating the KV store.

**Function timeout errors**
Timeouts are set to 60s in `vercel.json` for heavy routes (analyze, moodboards, export). If you're on Vercel Hobby plan, the max is 60s which should be enough.

**Blob URLs not loading in PDF**
Make sure `APP_URL` is set to your Vercel deployment URL in env vars.

**"Quota exceeded" on Gemini**
Create a new API key in a new Google Cloud project at aistudio.google.com/apikey.

---

## Free tier limits at a glance

| Service | Free limit |
|---------|-----------|
| Vercel Hobby | 100GB bandwidth, unlimited deploys |
| Vercel KV | 256MB, 3,000 req/day |
| Vercel Blob | 500MB storage, 1GB transfer |
| Gemini Flash | 1,500 req/day, 15 req/min |
| Hugging Face | Generous rate limits (undocumented) |

Enough for ~50–100 projects/month comfortably on free tier.
