# Deploying ArchPresent to Vercel

## Prerequisites
- Node.js 18+
- A Vercel account (free Hobby plan works)
- Vercel CLI: `sudo npm i -g vercel`

---

## Step 1 — Link to Vercel

```bash
vercel login
vercel link
```

---

## Step 2 — Create Blob storage (one-time)

Vercel Blob is the **only** storage service needed — it handles both file
uploads (plan images, logos, moodboards) AND project/firm data (stored as
JSON blobs). No Redis/KV required.

Go to your project in the Vercel dashboard:
- **Storage** tab → **Create Database** → **Blob**
- Name it `archpresent-blob`
- Click **Connect Project**

---

## Step 3 — Pull env variables

```bash
vercel env pull .env.local
```

This writes `BLOB_READ_WRITE_TOKEN` and `BLOB_STORE_ID` to your `.env.local`.

---

## Step 4 — Add your API keys to Vercel

```bash
vercel env add GOOGLE_AI_KEY        # Free at aistudio.google.com
vercel env add UNSPLASH_ACCESS_KEY  # Free at unsplash.com/developers
vercel env add POLLINATIONS_API_KEY # Free at enter.pollinations.ai (optional)
vercel env add APP_URL              # Your Vercel URL e.g. https://archpresent.vercel.app
```

Or add them in the Vercel dashboard → Settings → Environment Variables.

---

## Step 5 — Push your code and deploy

```bash
git add -A
git commit -m "deploy"
git push
```

Vercel auto-deploys on every push to main. Or deploy manually:
```bash
vercel deploy --prod
```

---

## Storage model

Everything goes to a single Vercel Blob store:

| Path | Contents |
|------|----------|
| `uploads/plan-{id}.png` | Floor plan images |
| `uploads/moodboard-{id}.jpg` | Generated moodboard images |
| `data/project-{id}.json` | Project data |
| `data/firm.json` | Firm profile |

Free tier: 500MB storage, 1GB transfer/month — enough for hundreds of projects.

---

## Troubleshooting

**"BLOB_READ_WRITE_TOKEN is not defined"**
Run `vercel env pull .env.local` after connecting Blob storage.

**Build fails**
Check the Logs tab in the Vercel deployment dashboard for the first red line.

**Images not loading after deploy**
Make sure `APP_URL` is set to your actual Vercel URL (no trailing slash).
