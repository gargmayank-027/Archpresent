/**
 * lib/store.ts
 *
 * Storage adapter — switches automatically between environments:
 *
 *   PRODUCTION (Vercel): Vercel Blob for EVERYTHING
 *     - access: "private" — works with both private and public stores
 *     - JSON data read back via blob.downloadUrl (signed, expires 1hr)
 *     - File uploads stored at uploads/{filename}
 *
 *   DEVELOPMENT (local): in-memory Map + JSON sidecar files + /public/uploads
 */

import type { Project, ProjectStore, FirmProfile, FirmStore } from "@/types";

const IS_VERCEL = !!process.env.BLOB_READ_WRITE_TOKEN;

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT STORE
// ─────────────────────────────────────────────────────────────────────────────

export const projectStore: ProjectStore = {
  async create(project) {
    if (IS_VERCEL) return blob_projectCreate(project);
    return local_projectCreate(project);
  },
  async get(id) {
    if (IS_VERCEL) return blob_projectGet(id);
    return local_projectGet(id);
  },
  async update(id, patch) {
    if (IS_VERCEL) return blob_projectUpdate(id, patch);
    return local_projectUpdate(id, patch);
  },
  async list() {
    if (IS_VERCEL) return blob_projectList();
    return local_projectList();
  },
  async delete(id) {
    if (IS_VERCEL) return blob_projectDelete(id);
    return local_projectDelete(id);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FIRM STORE
// ─────────────────────────────────────────────────────────────────────────────

export const firmStore: FirmStore = {
  async get() {
    if (IS_VERCEL) return blob_firmGet();
    return local_firmGet();
  },
  async set(profile) {
    if (IS_VERCEL) return blob_firmSet(profile);
    return local_firmSet(profile);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FILE UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

export async function saveUploadedFile(
  buffer: Buffer,
  filename: string
): Promise<{ url: string; diskPath: string }> {
  if (IS_VERCEL) return blob_saveFile(buffer, filename);
  return local_saveFile(buffer, filename);
}

export function ensureUploadDir() {
  if (IS_VERCEL) return;
  const { mkdirSync, existsSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const dir = join(process.cwd(), "public", "uploads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// VERCEL BLOB IMPLEMENTATION
// Uses access: "private" — compatible with both private and public stores.
// Reads content back using the blob's downloadUrl (a short-lived signed URL).
// ─────────────────────────────────────────────────────────────────────────────

async function getBlob() {
  return await import("@vercel/blob");
}

// Read a blob's content as JSON using its download URL
async function readBlobJson<T>(downloadUrl: string): Promise<T | null> {
  try {
    const res = await fetch(downloadUrl, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Project data ──────────────────────────────────────────────────────────

const projectKey = (id: string) => `data/project-${id}.json`;
const PROJECT_PREFIX = "data/project-";

async function blob_projectCreate(project: Project): Promise<Project> {
  const { put } = await getBlob();
  await put(projectKey(project.id), JSON.stringify(project), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return project;
}

async function blob_projectGet(id: string): Promise<Project | null> {
  try {
    const { list } = await getBlob();
    const { blobs } = await list({ prefix: projectKey(id) });
    if (!blobs.length) return null;
    return readBlobJson<Project>(blobs[0].downloadUrl);
  } catch {
    return null;
  }
}

async function blob_projectUpdate(id: string, patch: Partial<Project>): Promise<Project> {
  const existing = await blob_projectGet(id);
  if (!existing) throw new Error(`Project ${id} not found`);
  const updated = { ...existing, ...patch };
  await blob_projectCreate(updated);
  return updated;
}

async function blob_projectList(): Promise<Project[]> {
  try {
    const { list } = await getBlob();
    const { blobs } = await list({ prefix: PROJECT_PREFIX });
    if (!blobs.length) return [];

    const projects = await Promise.all(
      blobs.map((blob) => readBlobJson<Project>(blob.downloadUrl))
    );

    return (projects.filter(Boolean) as Project[]).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

async function blob_projectDelete(id: string): Promise<void> {
  const { list, del } = await getBlob();
  const { blobs } = await list({ prefix: projectKey(id) });
  if (blobs.length) await del(blobs.map((b) => b.url));
}

// ── Firm profile ──────────────────────────────────────────────────────────

const FIRM_KEY = "data/firm.json";

async function blob_firmGet(): Promise<FirmProfile | null> {
  try {
    const { list } = await getBlob();
    const { blobs } = await list({ prefix: FIRM_KEY });
    if (!blobs.length) return null;
    return readBlobJson<FirmProfile>(blobs[0].downloadUrl);
  } catch {
    return null;
  }
}

async function blob_firmSet(profile: FirmProfile): Promise<FirmProfile> {
  const { put } = await getBlob();
  await put(FIRM_KEY, JSON.stringify(profile), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return profile;
}

// ── File uploads ──────────────────────────────────────────────────────────

async function blob_saveFile(
  buffer: Buffer,
  filename: string
): Promise<{ url: string; diskPath: string }> {
  const { put } = await getBlob();
  const blob = await put(`uploads/${filename}`, buffer, {
    access: "private",
    contentType: getContentType(filename),
    addRandomSuffix: false,
  });
  // Use a proxy URL so the file can be displayed in <img> tags.
  // The raw blob.url requires authentication and can't be used directly
  // in browser image tags when the store is private.
  const proxyUrl = `/api/blob?url=${encodeURIComponent(blob.url)}`;
  return { url: proxyUrl, diskPath: blob.url };
}

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
    json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL IMPLEMENTATION (development)
// ─────────────────────────────────────────────────────────────────────────────

function getFs() { return require("fs") as typeof import("fs"); }
function getPath() { return require("path") as typeof import("path"); }

const DATA_FILE = () => getPath().join(process.cwd(), ".archpresent-data.json");
const FIRM_FILE = () => getPath().join(process.cwd(), ".archpresent-firm.json");
const UPLOAD_DIR = () => getPath().join(process.cwd(), "public", "uploads");

declare global {
  // eslint-disable-next-line no-var
  var __archpresent_projects__: Map<string, Project> | undefined;
  // eslint-disable-next-line no-var
  var __archpresent_firm__: FirmProfile | null | undefined;
}

function getProjectMap(): Map<string, Project> {
  if (!global.__archpresent_projects__) {
    const fs = getFs();
    try {
      if (fs.existsSync(DATA_FILE())) {
        const obj = JSON.parse(fs.readFileSync(DATA_FILE(), "utf-8")) as Record<string, Project>;
        global.__archpresent_projects__ = new Map(Object.entries(obj));
      } else {
        global.__archpresent_projects__ = new Map();
      }
    } catch {
      global.__archpresent_projects__ = new Map();
    }
  }
  return global.__archpresent_projects__!;
}

function saveProjectMap(map: Map<string, Project>) {
  const fs = getFs();
  fs.writeFileSync(DATA_FILE(), JSON.stringify(Object.fromEntries(map), null, 2));
}

async function local_projectCreate(project: Project): Promise<Project> {
  const map = getProjectMap();
  map.set(project.id, project);
  saveProjectMap(map);
  return project;
}

async function local_projectGet(id: string): Promise<Project | null> {
  return getProjectMap().get(id) ?? null;
}

async function local_projectUpdate(id: string, patch: Partial<Project>): Promise<Project> {
  const map = getProjectMap();
  const existing = map.get(id);
  if (!existing) throw new Error(`Project ${id} not found`);
  const updated = { ...existing, ...patch };
  map.set(id, updated);
  saveProjectMap(map);
  return updated;
}

async function local_projectList(): Promise<Project[]> {
  return Array.from(getProjectMap().values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

async function local_projectDelete(id: string): Promise<void> {
  const map = getProjectMap();
  map.delete(id);
  saveProjectMap(map);
}

async function local_firmGet(): Promise<FirmProfile | null> {
  if (global.__archpresent_firm__ !== undefined) return global.__archpresent_firm__;
  const fs = getFs();
  try {
    if (fs.existsSync(FIRM_FILE())) {
      global.__archpresent_firm__ = JSON.parse(fs.readFileSync(FIRM_FILE(), "utf-8")) as FirmProfile;
    } else {
      global.__archpresent_firm__ = null;
    }
  } catch {
    global.__archpresent_firm__ = null;
  }
  return global.__archpresent_firm__;
}

async function local_firmSet(profile: FirmProfile): Promise<FirmProfile> {
  global.__archpresent_firm__ = profile;
  const fs = getFs();
  fs.writeFileSync(FIRM_FILE(), JSON.stringify(profile, null, 2));
  return profile;
}

async function local_saveFile(
  buffer: Buffer,
  filename: string
): Promise<{ url: string; diskPath: string }> {
  const fs = getFs();
  const path = getPath();
  const dir = UPLOAD_DIR();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const diskPath = path.join(dir, filename);
  fs.writeFileSync(diskPath, buffer);
  return { url: `/uploads/${filename}`, diskPath };
}
