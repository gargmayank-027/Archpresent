/**
 * lib/store.ts
 *
 * Storage adapter — switches automatically:
 *
 *   1. SUPABASE (if SUPABASE_URL is set): Supabase Storage for files + JSON data
 *   2. VERCEL BLOB (if BLOB_READ_WRITE_TOKEN is set): legacy fallback
 *   3. LOCAL (development): filesystem + in-memory
 */

import type { Project, ProjectStore, FirmProfile, FirmStore } from "@/types";

const USE_SUPABASE = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const USE_BLOB = !USE_SUPABASE && !!process.env.BLOB_READ_WRITE_TOKEN;
const IS_PROD = USE_SUPABASE || USE_BLOB;

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT STORE
// ─────────────────────────────────────────────────────────────────────────────

export const projectStore: ProjectStore = {
  async create(project) {
    if (USE_SUPABASE) return supa_projectCreate(project);
    if (USE_BLOB) return blob_projectCreate(project);
    return local_projectCreate(project);
  },
  async get(id) {
    if (USE_SUPABASE) return supa_projectGet(id);
    if (USE_BLOB) return blob_projectGet(id);
    return local_projectGet(id);
  },
  async update(id, patch) {
    if (USE_SUPABASE) return supa_projectUpdate(id, patch);
    if (USE_BLOB) return blob_projectUpdate(id, patch);
    return local_projectUpdate(id, patch);
  },
  async list() {
    if (USE_SUPABASE) return supa_projectList();
    if (USE_BLOB) return blob_projectList();
    return local_projectList();
  },
  async delete(id) {
    if (USE_SUPABASE) return supa_projectDelete(id);
    if (USE_BLOB) return blob_projectDelete(id);
    return local_projectDelete(id);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FIRM STORE
// ─────────────────────────────────────────────────────────────────────────────

export const firmStore: FirmStore = {
  async get() {
    if (USE_SUPABASE) return supa_firmGet();
    if (USE_BLOB) return blob_firmGet();
    return local_firmGet();
  },
  async set(profile) {
    if (USE_SUPABASE) return supa_firmSet(profile);
    if (USE_BLOB) return blob_firmSet(profile);
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
  if (USE_SUPABASE) return supa_saveFile(buffer, filename);
  if (USE_BLOB) return blob_saveFile(buffer, filename);
  return local_saveFile(buffer, filename);
}

export function ensureUploadDir() {
  if (IS_PROD) return;
  const { mkdirSync, existsSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const dir = join(process.cwd(), "public", "uploads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ═════════════════════════════════════════════════════════════════════════════
// SUPABASE IMPLEMENTATION
// ═════════════════════════════════════════════════════════════════════════════

async function getSupa() {
  return await import("@/lib/supabase");
}

const supaProjectKey = (id: string) => `project-${id}.json`;

async function supa_projectCreate(project: Project): Promise<Project> {
  const { supaUpload } = await getSupa();
  await supaUpload(Buffer.from(JSON.stringify(project)), supaProjectKey(project.id), "application/json");
  return project;
}

async function supa_projectGet(id: string): Promise<Project | null> {
  try {
    const { supaDownload } = await getSupa();
    const buf = await supaDownload(supaProjectKey(id));
    return JSON.parse(buf.toString()) as Project;
  } catch {
    return null;
  }
}

async function supa_projectUpdate(id: string, patch: Partial<Project>): Promise<Project> {
  const existing = await supa_projectGet(id);
  if (!existing) throw new Error(`Project ${id} not found`);
  const updated = { ...existing, ...patch };
  await supa_projectCreate(updated);
  return updated;
}

async function supa_projectList(): Promise<Project[]> {
  try {
    const { supaList, supaDownload } = await getSupa();
    const files = await supaList("");
    const projectFiles = files.filter((f) => f.startsWith("project-") && f.endsWith(".json"));

    const projects = await Promise.all(
      projectFiles.map(async (path) => {
        try {
          const buf = await supaDownload(path);
          return JSON.parse(buf.toString()) as Project;
        } catch {
          return null;
        }
      })
    );

    return (projects.filter(Boolean) as Project[]).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

async function supa_projectDelete(id: string): Promise<void> {
  const { supaDelete } = await getSupa();
  await supaDelete([supaProjectKey(id)]);
}

async function supa_firmGet(): Promise<FirmProfile | null> {
  try {
    const { supaDownload } = await getSupa();
    const buf = await supaDownload("firm.json");
    return JSON.parse(buf.toString()) as FirmProfile;
  } catch {
    return null;
  }
}

async function supa_firmSet(profile: FirmProfile): Promise<FirmProfile> {
  const { supaUpload } = await getSupa();
  await supaUpload(Buffer.from(JSON.stringify(profile)), "firm.json", "application/json");
  return profile;
}

async function supa_saveFile(buffer: Buffer, filename: string): Promise<{ url: string; diskPath: string }> {
  const { supaUpload } = await getSupa();
  const path = `uploads/${filename}`;
  const url = await supaUpload(buffer, path);
  return { url, diskPath: url };
}

// ═════════════════════════════════════════════════════════════════════════════
// VERCEL BLOB IMPLEMENTATION (legacy fallback)
// ═════════════════════════════════════════════════════════════════════════════

async function getBlob() {
  return await import("@vercel/blob");
}

async function readBlobJson<T>(downloadUrl: string): Promise<T | null> {
  try {
    const res = await fetch(downloadUrl, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

const blobProjectKey = (id: string) => `data/project-${id}.json`;

async function blob_projectCreate(project: Project): Promise<Project> {
  const { put } = await getBlob();
  await put(blobProjectKey(project.id), JSON.stringify(project), { access: "public", contentType: "application/json", addRandomSuffix: false });
  return project;
}

async function blob_projectGet(id: string): Promise<Project | null> {
  try {
    const { list } = await getBlob();
    const { blobs } = await list({ prefix: blobProjectKey(id) });
    if (!blobs.length) return null;
    return readBlobJson<Project>(blobs[0].url);
  } catch { return null; }
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
    const { blobs } = await list({ prefix: "data/project-" });
    if (!blobs.length) return [];
    const projects = await Promise.all(blobs.map((b) => readBlobJson<Project>(b.url)));
    return (projects.filter(Boolean) as Project[]).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch { return []; }
}

async function blob_projectDelete(id: string): Promise<void> {
  const { list, del } = await getBlob();
  const { blobs } = await list({ prefix: blobProjectKey(id) });
  if (blobs.length) await del(blobs.map((b) => b.url));
}

async function blob_firmGet(): Promise<FirmProfile | null> {
  try {
    const { list } = await getBlob();
    const { blobs } = await list({ prefix: "firm.json" });
    if (!blobs.length) return null;
    return readBlobJson<FirmProfile>(blobs[0].url);
  } catch { return null; }
}

async function blob_firmSet(profile: FirmProfile): Promise<FirmProfile> {
  const { put } = await getBlob();
  await put("firm.json", JSON.stringify(profile), { access: "public", contentType: "application/json", addRandomSuffix: false });
  return profile;
}

async function blob_saveFile(buffer: Buffer, filename: string): Promise<{ url: string; diskPath: string }> {
  const { put } = await getBlob();
  const blob = await put(`uploads/${filename}`, buffer, { access: "public", contentType: getContentType(filename), addRandomSuffix: false });
  return { url: blob.url, diskPath: blob.url };
}

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "pdf") return "application/pdf";
  if (ext === "json") return "application/json";
  return "application/octet-stream";
}

// ═════════════════════════════════════════════════════════════════════════════
// LOCAL DEVELOPMENT IMPLEMENTATION
// ═════════════════════════════════════════════════════════════════════════════

declare global {
  var __archpresent_projects__: Map<string, Project> | undefined;
  var __archpresent_firm__: FirmProfile | null | undefined;
}

function PROJECTS_FILE() {
  const { join } = require("path") as typeof import("path");
  return join(process.cwd(), "public", "uploads", "projects.json");
}

function FIRM_FILE() {
  const { join } = require("path") as typeof import("path");
  return join(process.cwd(), "public", "uploads", "firm.json");
}

function loadProjectsMap(): Map<string, Project> {
  if (global.__archpresent_projects__) return global.__archpresent_projects__;
  const fs = require("fs") as typeof import("fs");
  const map = new Map<string, Project>();
  try {
    const arr = JSON.parse(fs.readFileSync(PROJECTS_FILE(), "utf-8")) as Project[];
    for (const p of arr) map.set(p.id, p);
  } catch { /* empty */ }
  global.__archpresent_projects__ = map;
  return map;
}

function persistProjects(map: Map<string, Project>) {
  ensureUploadDir();
  const fs = require("fs") as typeof import("fs");
  fs.writeFileSync(PROJECTS_FILE(), JSON.stringify([...map.values()], null, 2));
}

function local_projectCreate(project: Project): Project {
  const map = loadProjectsMap(); map.set(project.id, project); persistProjects(map); return project;
}
function local_projectGet(id: string): Project | null {
  return loadProjectsMap().get(id) ?? null;
}
function local_projectUpdate(id: string, patch: Partial<Project>): Project {
  const map = loadProjectsMap();
  const existing = map.get(id);
  if (!existing) throw new Error(`Project ${id} not found`);
  const updated = { ...existing, ...patch };
  map.set(id, updated); persistProjects(map); return updated;
}
function local_projectList(): Project[] {
  return [...loadProjectsMap().values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
function local_projectDelete(id: string): void {
  const map = loadProjectsMap(); map.delete(id); persistProjects(map);
}

function local_firmGet(): FirmProfile | null {
  if (global.__archpresent_firm__ !== undefined) return global.__archpresent_firm__;
  const fs = require("fs") as typeof import("fs");
  try {
    global.__archpresent_firm__ = JSON.parse(fs.readFileSync(FIRM_FILE(), "utf-8")) as FirmProfile;
  } catch { global.__archpresent_firm__ = null; }
  return global.__archpresent_firm__;
}

function local_firmSet(profile: FirmProfile): FirmProfile {
  global.__archpresent_firm__ = profile;
  ensureUploadDir();
  const fs = require("fs") as typeof import("fs");
  fs.writeFileSync(FIRM_FILE(), JSON.stringify(profile, null, 2));
  return profile;
}

function local_saveFile(buffer: Buffer, filename: string): { url: string; diskPath: string } {
  ensureUploadDir();
  const { join } = require("path") as typeof import("path");
  const fs = require("fs") as typeof import("fs");
  const diskPath = join(process.cwd(), "public", "uploads", filename);
  fs.writeFileSync(diskPath, buffer);
  return { url: `/uploads/${filename}`, diskPath };
}
