/**
 * lib/supabase.ts — Supabase client for storage
 *
 * Uses Supabase Storage (1GB free) for file uploads and JSON data.
 * Replaces Vercel Blob which was suspended due to free tier limits.
 *
 * Setup:
 *   1. Create a Supabase project at supabase.com
 *   2. Go to Storage → Create bucket "archpresent" → set to PUBLIC
 *   3. Add env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env vars. " +
      "Create a free project at supabase.com."
    );
  }

  _client = createClient(url, key);
  return _client;
}

const BUCKET = "archpresent";

/**
 * Upload a file to Supabase Storage. Overwrites if exists.
 */
export async function supaUpload(
  buffer: Buffer,
  path: string,
  contentType?: string
): Promise<string> {
  const supabase = getSupabase();

  // Sanitize path — no leading slash, no double slashes
  const cleanPath = path.replace(/^\/+/, "").replace(/\/\//g, "/");

  const ct = contentType
    ?? (cleanPath.endsWith(".png") ? "image/png"
      : cleanPath.endsWith(".jpg") || cleanPath.endsWith(".jpeg") ? "image/jpeg"
      : cleanPath.endsWith(".pdf") ? "application/pdf"
      : cleanPath.endsWith(".json") ? "application/json"
      : "application/octet-stream");

  console.log(`[supabase] Uploading to bucket="${BUCKET}" path="${cleanPath}" size=${buffer.length} type=${ct}`);

  // Convert Buffer to Uint8Array — Supabase client may not handle Node Buffer correctly
  const body = new Uint8Array(buffer);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(cleanPath, body, {
      contentType: ct,
      upsert: true,
    });

  if (error) {
    console.error(`[supabase] Upload error:`, JSON.stringify(error));
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(cleanPath);
  console.log(`[supabase] Upload success: ${data.publicUrl}`);
  return data.publicUrl;
}

/**
 * Download a file from Supabase Storage.
 */
export async function supaDownload(path: string): Promise<Buffer> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Supabase download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Delete a file from Supabase Storage.
 */
export async function supaDelete(paths: string[]): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(`Supabase delete failed: ${error.message}`);
}

/**
 * List files in a folder.
 */
export async function supaList(folder?: string): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).list(folder || undefined, {
    limit: 1000,
  });
  if (error) throw new Error(`Supabase list failed: ${error.message}`);
  return (data ?? [])
    .filter((f) => f.name && !f.name.startsWith("."))
    .map((f) => folder ? `${folder}/${f.name}` : f.name);
}

/**
 * Get the public URL for a file (without downloading).
 */
export function supaPublicUrl(path: string): string {
  const supabase = getSupabase();
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
