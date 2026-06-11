/**
 * lib/store.ts
 *
 * Storage adapter with two implementations that switch automatically:
 *
 *   PRODUCTION (Vercel): uses Vercel KV (Redis) for project/firm data
 *                        uses Vercel Blob for file uploads
 *
 *   DEVELOPMENT (local): uses in-memory Map + JSON sidecar files
 *                        uses local /public/uploads directory
 *
 * Detection: if BLOB_READ_WRITE_TOKEN is set → Vercel mode.
 *            Otherwise → local mode.
 *
 * To set up Vercel storage:
 *   1. vercel link (link your project)
 *   2. vercel storage create kv   → adds KV_URL etc to env
 *   3. vercel storage create blob → adds BLOB_READ_WRITE_TOKEN to env
 *   4. vercel env pull .env.local → pulls them to local
 */

import type { Project, ProjectStore, FirmProfile, FirmStore } from "@/types";

const IS_VERCEL = !!process.env.BLOB_READ_WRITE_TOKEN;

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT STORE
// ─────────────────────────────────────────────────────────────────────────────

export const projectStore: ProjectStore = {
  async create(project) {
    if (IS_VERCEL) return kv_projectCreate(project);
    return local_projectCreate(project);
  },
  async get(id) {
    if (IS_VERCEL) return kv_projectGet(id);
    return local_projectGet(id);
  },
  async update(id, patch) {
    if (IS_VERCEL) return kv_projectUpdate(id, patch);
    return local_projectUpdate(id, patch);
  },
  async list() {
    if (IS_VERCEL) return kv_projectList();
    return local_projectList();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FIRM STORE
// ─────────────────────────────────────────────────────────────────────────────

export const firmStore: FirmStore = {
  async get() {
    if (IS_VERCEL) return kv_firmGet();
    return local_firmGet();
  },
  async set(profile) {
    if (IS_VERCEL) return kv_firmSet(profile);
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
  if (IS_VERCEL) return; // no-op on Vercel
  const { mkdirSync, existsSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const dir = join(process.cwd(), "public", "uploads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// VERCEL KV IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

async function getKV() {
  const { kv } = await import("@vercel/kv");
  return kv;
}

async function kv_projectCreate(project: Project): Promise<Project> {
  const kv = await getKV();
  await kv.set(`project:${project.id}`, project);
  // Add to index sorted by createdAt
  await kv.zadd("projects:index", {
    score: new Date(project.createdAt).getTime(),
    member: project.id,
  });
  return project;
}

async function kv_projectGet(id: string): Promise<Project | null> {
  const kv = await getKV();
  return (await kv.get<Project>(`project:${id}`)) ?? null;
}

async function kv_projectUpdate(id: string, patch: Partial<Project>): Promise<Project> {
  const kv      = await getKV();
  const existing = await kv.get<Project>(`project:${id}`);
  if (!existing) throw new Error(`Project ${id} not found`);
  const updated = { ...existing, ...patch };
  await kv.set(`project:${id}`, updated);
  return updated;
}

async function kv_projectList(): Promise<Project[]> {
  const kv  = await getKV();
  // Get IDs sorted by score desc (newest first)
  const ids = await kv.zrange("projects:index", 0, -1, { rev: true }) as string[];
  if (!ids.length) return [];
  const projects = await Promise.all(ids.map((id) => kv.get<Project>(`project:${id}`)));
  return projects.filter((p): p is Project => !!p);
}

async function kv_firmGet(): Promise<FirmProfile | null> {
  const kv = await getKV();
  return (await kv.get<FirmProfile>("firm:profile")) ?? null;
}

async function kv_firmSet(profile: FirmProfile): Promise<FirmProfile> {
  const kv = await getKV();
  await kv.set("firm:profile", profile);
  return profile;
}

// ─────────────────────────────────────────────────────────────────────────────
// VERCEL BLOB IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

async function blob_saveFile(
  buffer: Buffer,
  filename: string
): Promise<{ url: string; diskPath: string }> {
  const { put } = await import("@vercel/blob");
  const blob = await put(`uploads/${filename}`, buffer, {
    access: "public",
    contentType: getContentType(filename),
  });
  // diskPath is the blob URL on Vercel (used by pdf.ts for image loading)
  return { url: blob.url, diskPath: blob.url };
}

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL IMPLEMENTATION (development)
// ─────────────────────────────────────────────────────────────────────────────

// Lazy imports so fs/path are only loaded in Node (not Edge runtime)
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
  const fs   = getFs();
  const path = getPath();
  const dir  = UPLOAD_DIR();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const diskPath = path.join(dir, filename);
  fs.writeFileSync(diskPath, buffer);
  return { url: `/uploads/${filename}`, diskPath };
}
