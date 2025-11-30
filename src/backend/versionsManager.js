// src/backend/versionsManager.js
const path = require('path');
const fs = require('fs-extra');
const projectManager = require('./projectManager');

// Cartella snapshot: <project>/.versions/*.json
function versionsDir(projectId) {
  return path.join(projectManager.getProjectPath(projectId), '.versions');
}

// Utility: label -> slug per filename
function slugify(s = '') {
  return String(s)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .toLowerCase();
}

function makeVersionId(ts, label) {
  const stamp = String(ts);
  const slug = slugify(label || '');
  return slug ? `${stamp}__${slug}.json` : `${stamp}.json`;
}

function parseVersionId(id) {
  const m = String(id).match(/^(\d{13})(?:__([^.]+))?\.json$/);
  if (!m) return { ts: null, label: '' };
  return { ts: Number(m[1]), label: (m[2] || '').replace(/-/g, ' ') };
}

// Legge tutti i file .txt nella root del progetto (le sezioni)
async function readAllSections(projectId) {
  const base = projectManager.getProjectPath(projectId);
  const entries = await fs.readdir(base);
  const data = {};
  for (const name of entries) {
    if (!name.endsWith('.txt')) continue;
    const full = path.join(base, name);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    const section = name.replace(/\.txt$/i, '');
    data[section] = await fs.readFile(full, 'utf-8');
  }
  return data;
}

// Scrive tutte le sezioni .txt dal payload
async function writeAllSections(projectId, sectionsMap) {
  const base = projectManager.getProjectPath(projectId);
  await fs.ensureDir(base);
  const entries = Object.entries(sectionsMap || {});
  for (const [section, content] of entries) {
    const filePath = path.join(base, `${section}.txt`);
    await fs.outputFile(filePath, content ?? '');
  }
}

async function listVersions(projectId) {
  const dir = versionsDir(projectId);
  await fs.ensureDir(dir);
  const files = await fs.readdir(dir);
  const items = [];
  for (const f of files) {
    if (!/\.json$/i.test(f)) continue;
    const full = path.join(dir, f);
    try {
      const stat = await fs.stat(full);
      const { ts, label } = parseVersionId(f);
      items.push({
        id: f,
        createdAt: ts || stat.mtimeMs,
        label: label || '',
        size: stat.size,
        sizeHuman: `${Math.max(1, Math.round(stat.size / 1024))} KB`,
      });
    } catch {
      // ignora file corrotti/sconosciuti
    }
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items;
}

async function createVersion(projectId, opts = {}) {
  const dir = versionsDir(projectId);
  await fs.ensureDir(dir);

  const label = typeof opts === 'string' ? opts : (opts?.label || '');
  const sections = await readAllSections(projectId);

  const now = Date.now();
  const id = makeVersionId(now, label);
  const file = path.join(dir, id);

  const payload = {
    projectId,
    label,
    createdAt: now,
    format: 'project-snapshot',
    sections, // { sectionName: contentHTML/JSONstring }
  };

  await fs.writeJson(file, payload, { spaces: 2 });
  return { id, createdAt: now, label };
}

async function getVersion(projectId, versionId) {
  const file = path.join(versionsDir(projectId), versionId);
  if (!(await fs.pathExists(file))) throw new Error('Versione non trovata');
  return fs.readJson(file);
}

async function restoreVersion(projectId, versionId) {
  const data = await getVersion(projectId, versionId);
  await writeAllSections(projectId, data.sections || {});
  return true;
}

async function deleteVersion(projectId, versionId) {
  const file = path.join(versionsDir(projectId), versionId);
  await fs.remove(file);
  return true;
}

async function renameVersion(projectId, versionId, newLabel = '') {
  const dir = versionsDir(projectId);
  const src = path.join(dir, versionId);
  if (!(await fs.pathExists(src))) throw new Error('Versione non trovata');

  const data = await fs.readJson(src);
  const { ts } = parseVersionId(versionId);
  let targetId = makeVersionId(ts || data.createdAt || Date.now(), newLabel);
  let dest = path.join(dir, targetId);

  // Evita overwrite se esiste già un file con lo stesso nome
  if (await fs.pathExists(dest)) {
    let i = 2;
    while (await fs.pathExists(dest)) {
      const altId = makeVersionId(ts || data.createdAt || Date.now(), `${newLabel}-${i}`);
      dest = path.join(dir, altId);
      targetId = altId;
      i++;
    }
  }

  data.label = newLabel || '';
  await fs.writeJson(dest, data, { spaces: 2 });
  if (dest !== src) await fs.remove(src);

  return { id: targetId, label: data.label };
}

module.exports = {
  listVersions,
  createVersion,
  getVersion,
  restoreVersion,
  deleteVersion,
  renameVersion,
};
