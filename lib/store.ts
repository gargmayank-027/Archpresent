/**
 * lib/store.ts
 *
 * In-memory store for v1, backed by two JSON sidecar files:
 *   .archpresent-data.json   — projects map
 *   .archpresent-firm.json   — single firm profile object
 *
 * To swap in a real DB: implement ProjectStore / FirmStore interfaces and
 * replace the exports below.
 */

import fs from "fs";
import path from "path";
import type { Project, ProjectStore, FirmProfile, FirmStore } from "@/types";

// ─── File paths ───────────────────────────────────────────────────────────────

const DATA_FILE = path.join(process.cwd(), ".archpresent-data.json");
const FIRM_FILE = path.join(process.cwd(), ".archpresent-firm.json");

// ─── Projects persistence ─────────────────────────────────────────────────────

function loadProjectsFromDisk(): Map<string, Project> {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const obj = JSON.parse(raw) as Record<string, Project>;
      return new Map(Object.entries(obj));
    }
  } catch { /* corrupt — start fresh */ }
  return new Map();
}

function saveProjectsToDisk(map: Map<string, Project>) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(Object.fromEntries(map.entries()), null, 2), "utf-8");
}

// Singleton — survives Next.js hot reloads
declare global {
  // eslint-disable-next-line no-var
  var __archpresent_projects__: Map<string, Project> | undefined;
  // eslint-disable-next-line no-var
  var __archpresent_firm__: FirmProfile | null | undefined;
}

const projectMap: Map<string, Project> =
  global.__archpresent_projects__ ??
  (global.__archpresent_projects__ = loadProjectsFromDisk());

export const projectStore: ProjectStore = {
  async create(project) {
    projectMap.set(project.id, project);
    saveProjectsToDisk(projectMap);
    return project;
  },
  async get(id) { return projectMap.get(id) ?? null; },
  async update(id, patch) {
    const existing = projectMap.get(id);
    if (!existing) throw new Error(`Project ${id} not found`);
    const updated = { ...existing, ...patch };
    projectMap.set(id, updated);
    saveProjectsToDisk(projectMap);
    return updated;
  },
  async list() {
    return Array.from(projectMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },
};

// ─── Firm profile persistence ─────────────────────────────────────────────────

function loadFirmFromDisk(): FirmProfile | null {
  try {
    if (fs.existsSync(FIRM_FILE)) {
      const raw = fs.readFileSync(FIRM_FILE, "utf-8");
      return JSON.parse(raw) as FirmProfile;
    }
  } catch { /* corrupt — return null */ }
  return null;
}

function saveFirmToDisk(profile: FirmProfile) {
  fs.writeFileSync(FIRM_FILE, JSON.stringify(profile, null, 2), "utf-8");
}

// undefined = not yet loaded; null = loaded but no profile saved
if (global.__archpresent_firm__ === undefined) {
  global.__archpresent_firm__ = loadFirmFromDisk();
}

export const firmStore: FirmStore = {
  async get() {
    return global.__archpresent_firm__ ?? null;
  },
  async set(profile) {
    global.__archpresent_firm__ = profile;
    saveFirmToDisk(profile);
    return profile;
  },
};

// ─── File storage abstraction ─────────────────────────────────────────────────
// Swap uploadFile to use S3 / Cloudflare R2 later.

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function saveUploadedFile(
  buffer: Buffer,
  filename: string
): Promise<{ url: string; diskPath: string }> {
  ensureUploadDir();
  const diskPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(diskPath, buffer);
  return { url: `/uploads/${filename}`, diskPath };
}
