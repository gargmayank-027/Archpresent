/**
 * lib/supabase.ts — Supabase Storage via direct REST API
 *
 * Uses fetch() directly to the Storage API endpoint instead of the
 * supabase-js client, which was routing requests to PostgREST (PGRST125).
 *
 * Setup:
 *   1. Create bucket "archpresent" in Supabase → Storage (set to PUBLIC)
 *   2. Add RLS policy: allow all operations for all users
 *   3. Set env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const BUCKET = "archpresent";

function getConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return { url, key };
}

/**
 * Upload a file to Supabase Storage. Overwrites if exists.
 */
export async function supaUpload(
  buffer: Buffer,
  path: string,
  contentType?: string
): Promise<string> {
  const { url, key } = getConfig();
  const cleanPath = path.replace(/^\/+/, "").replace(/\/\//g, "/");

  const ct = contentType
    ?? (cleanPath.endsWith(".png") ? "image/png"
      : cleanPath.endsWith(".jpg") || cleanPath.endsWith(".jpeg") ? "image/jpeg"
      : cleanPath.endsWith(".pdf") ? "application/pdf"
      : cleanPath.endsWith(".json") ? "application/json"
      : "application/octet-stream");

  console.log(`[supabase] Upload: bucket=${BUCKET} path=${cleanPath} size=${buffer.length}`);

  // Use upsert endpoint (POST with x-upsert header)
  const res = await fetch(
    `${url}/storage/v1/object/${BUCKET}/${cleanPath}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "apikey": key,
        "Content-Type": ct,
        "x-upsert": "true",
      },
      body: buffer,
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[supabase] Upload failed (${res.status}): ${errText}`);
    throw new Error(`Supabase upload failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  // Public URL
  const publicUrl = `${url}/storage/v1/object/public/${BUCKET}/${cleanPath}`;
  console.log(`[supabase] OK: ${publicUrl.slice(0, 80)}…`);
  return publicUrl;
}

/**
 * Download a file from Supabase Storage.
 */
export async function supaDownload(path: string): Promise<Buffer> {
  const { url, key } = getConfig();
  const cleanPath = path.replace(/^\/+/, "");

  const res = await fetch(
    `${url}/storage/v1/object/${BUCKET}/${cleanPath}`,
    {
      headers: {
        "Authorization": `Bearer ${key}`,
        "apikey": key,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Supabase download failed (${res.status})`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Delete files from Supabase Storage.
 */
export async function supaDelete(paths: string[]): Promise<void> {
  const { url, key } = getConfig();

  await fetch(
    `${url}/storage/v1/object/${BUCKET}`,
    {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${key}`,
        "apikey": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: paths }),
    }
  );
}

/**
 * List files in Supabase Storage.
 */
export async function supaList(folder?: string): Promise<string[]> {
  const { url, key } = getConfig();

  const res = await fetch(
    `${url}/storage/v1/object/list/${BUCKET}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "apikey": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix: folder || "",
        limit: 1000,
        offset: 0,
      }),
    }
  );

  if (!res.ok) return [];

  const data = await res.json();
  return (data ?? [])
    .filter((f: any) => f.name && !f.name.startsWith("."))
    .map((f: any) => folder ? `${folder}/${f.name}` : f.name);
}

/**
 * Get public URL for a file.
 */
export function supaPublicUrl(path: string): string {
  const { url } = getConfig();
  return `${url}/storage/v1/object/public/${BUCKET}/${path}`;
}
