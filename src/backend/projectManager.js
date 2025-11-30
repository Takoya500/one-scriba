// src/backend/projectManager.js
const path = require('path');
const fs = require('fs-extra');

const { app } = require('electron');
const baseDir = path.join(app.getPath('userData'), 'projects');
fs.ensureDirSync(baseDir);
const typeFileName = 'project.type';

// Sezioni per ogni tipo di progetto (ordine = sidebar)
const sectionsByType = {
  // SCENEGGIATURA
  sceneggiatura: [
    'concept',        // idea di base, logline, genere, tono
    'soggetto',       // riassunto narrativo breve
    'trattamento',    // racconto esteso
    'scaletta',       // sequenza scene
    'bibbia',         // mondo narrativo, luoghi, regole
    'personaggi',     // schede personaggi
    'scene',          // stesura in formato sceneggiatura
    'storyboard',     // visual / inquadrature
    'spoglio',        // elementi produzione
    'timeline',       // ordine cronologico interno
    'note'            // idee e appunti
  ],

  // LIBRO
  libro: [
    'soggetto_logline', // premessa/tema
    'outline',          // struttura macro
    'scaletta',         // scaletta capitoli
    'capitoli',         // editor principale
    'personaggi',       // schede + relazioni
    'bibbia',           // luoghi/regole/continuità
    'timeline',         // eventi ordinati
    'note',             // idee / to-do
    'revisioni'         // roadmap modifiche, changelog
  ],

  // TEATRO
  teatro: [
    'premessa_sinossi', // premessa & sinossi
    'scaletta',         // atti → scene (unificato, ex "struttura")
    'scene',            // stili: personaggio, battuta, didascalia
    'personaggi',       // schede + entrate/uscite
    'bibbia',           // mondo / coerenza / indicazioni registiche
    'didascalie',       // oggetti, ambienti, suoni/luci (metadati)
    'timeline',         // ordito / turning points
    'note_prova',       // appunti da letture/repliche
    'revisioni'         // versioning per scena/atto
  ]
};

/* =========================
   Helpers ID ↔ (nome, tipo)
   ========================= */

// ID cartella = `${displayName}__${type}` per i progetti nuovi.
// Legacy: cartelle senza suffisso, con file project.type.
function normalizeName(n) {
  return String(n || '').trim();
}

function composeId(displayName, type) {
  return `${normalizeName(displayName)}__${type}`;
}

function parseId(id) {
  const m = String(id || '').match(/^(.*)__([a-z]+)$/i);
  if (m) return { displayName: m[1], type: m[2] };
  // legacy: nessun suffisso
  return { displayName: id, type: null };
}

/* =========================
   Path helpers
   ========================= */

function getProjectPathById(id /* nome cartella effettivo */) {
  return path.join(baseDir, id);
}

// Alias per compatibilità: in tutto il codice "name" è in realtà l'ID cartella
function getProjectPath(name /* id cartella */) {
  return getProjectPathById(name);
}

function isValidType(type) {
  return Object.prototype.hasOwnProperty.call(sectionsByType, type);
}

/* =========================
   Creazione file di sezione
   ========================= */
async function ensureProjectSections(projectId, type) {
  const projectPath = getProjectPathById(projectId);
  const sections = sectionsByType[type] || [];
  await fs.ensureDir(projectPath);

  // --- MIGRAZIONE RETRO-COMPATIBILITÀ ---
  // Se esiste "struttura.txt" (vecchio nome) e manca "scaletta.txt", rinomina.
  try {
    const oldPath = path.join(projectPath, 'struttura.txt');
    const newPath = path.join(projectPath, 'scaletta.txt');
    if (await fs.pathExists(oldPath) && !(await fs.pathExists(newPath))) {
      await fs.move(oldPath, newPath);
    }
  } catch (_) { /* non bloccare la creazione se fallisce la migrazione */ }
  // --- FINE MIGRAZIONE ---

  for (const section of sections) {
    const filePath = path.join(projectPath, `${section}.txt`);
    await fs.ensureFile(filePath);
  }
  return true;
}
/* =========================
   Migrazione automatica progetti vecchi
   ========================= */
async function migrateLegacyProject(projectId) {
  try {
    // 1️⃣ Assicura che tutte le sezioni previste dal tipo siano presenti
    const type = await getProjectType(projectId);
    await ensureProjectSections(projectId, type);

    // 2️⃣ Esegue eventuali rinomine note (es. vecchi file)
    const projectPath = getProjectPathById(projectId);
    const fixes = [
      { old: 'struttura.txt', new: 'scaletta.txt' },
      // 👇 puoi aggiungere qui eventuali rinomine future
      // { old: 'vecchionome.txt', new: 'nuovonome.txt' },
    ];

    for (const fix of fixes) {
      const oldPath = path.join(projectPath, fix.old);
      const newPath = path.join(projectPath, fix.new);
      if (await fs.pathExists(oldPath) && !(await fs.pathExists(newPath))) {
        await fs.move(oldPath, newPath);
        console.log(`[migrate] Rinominato ${fix.old} → ${fix.new}`);
      }
    }

    console.log(`[migrate] Project ${projectId} verificato e aggiornato`);
  } catch (err) {
    console.warn(`[migrate] Errore migrazione ${projectId}:`, err);
  }
}

/* =========================
   API
   ========================= */

// Crea un nuovo progetto (ritorna l'ID cartella)
async function createProject(displayName, type = 'sceneggiatura') {
  const normalizedType = isValidType(type) ? type : 'sceneggiatura';
  await fs.ensureDir(baseDir);

  const legacyPath = getProjectPathById(normalizeName(displayName)); // es. "Roma"
  const newId = composeId(displayName, normalizedType);              // es. "Roma__libro"
  const newPath = getProjectPathById(newId);

  // (1) Se esiste già la cartella nuova con stesso nome+tipo -> blocca
  if (await fs.pathExists(newPath)) {
    throw new Error('Esiste già un progetto con questo nome e questo tipo.');
  }

  // (2) Se esiste una cartella legacy con lo stesso nome e lo stesso tipo -> blocca
  if (await fs.pathExists(legacyPath)) {
    const legacyTypePath = path.join(legacyPath, typeFileName);
    if (await fs.pathExists(legacyTypePath)) {
      const legacyType = (await fs.readFile(legacyTypePath, 'utf-8')).trim();
      if (legacyType === normalizedType) {
        throw new Error('Esiste già un progetto con questo nome e questo tipo.');
      }
    }
  }

  // Crea la cartella con suffisso tipo
  await fs.ensureDir(newPath);
  await fs.writeFile(path.join(newPath, typeFileName), normalizedType, 'utf-8');

  // Crea i file sezione
  await ensureProjectSections(newId, normalizedType);

  return newId;
}

// Elimina un progetto (cartella completa)
async function deleteProject(projectId /* id cartella */) {
  const projectPath = getProjectPathById(projectId);
  await fs.remove(projectPath);
  return true;
}

// Rinomina un progetto (sposta la cartella) — ritorna il nuovo ID
async function renameProject(oldId /* id attuale */, newDisplayName /* nuovo nome "umano" */) {
  const oldPath = getProjectPathById(oldId);
  if (!(await fs.pathExists(oldPath))) {
    throw new Error('Progetto di origine inesistente');
  }

  // Ricava il tipo dal file (o fallback)
  const type = await getProjectType(oldId);
  const newId = composeId(newDisplayName, type);
  const newPath = getProjectPathById(newId);

  // Blocca se esiste già un progetto con stesso nome+tipo (nuovo o legacy)
  if (await fs.pathExists(newPath)) {
    throw new Error('Esiste già un progetto con questo nome e questo tipo.');
  }
  const legacySameNamePath = getProjectPathById(normalizeName(newDisplayName));
  if (await fs.pathExists(legacySameNamePath)) {
    const tPath = path.join(legacySameNamePath, typeFileName);
    if (await fs.pathExists(tPath)) {
      const legacyType = (await fs.readFile(tPath, 'utf-8')).trim();
      if (legacyType === type) {
        throw new Error('Esiste già un progetto con questo nome e questo tipo.');
      }
    }
  }

  await fs.move(oldPath, newPath, { overwrite: false });
  return newId;
}

// Lista tutti i progetti (ritorna [{id, name, type}], ordinati per mtime desc)
async function listProjects() {
  await fs.ensureDir(baseDir);
  const entries = await fs.readdir(baseDir);

  const projects = [];
  for (const id of entries) {
    const fullPath = path.join(baseDir, id);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isDirectory()) continue;

      const type = await getProjectType(id); // legge project.type o fallback
      const parsed = parseId(id);
      const displayName = parsed.type ? parsed.displayName : id; // legacy: mostra id

      projects.push({
        id,
        name: displayName,
        type,
        mtimeMs: stat.mtimeMs
      });
    } catch {
      // ignora voci problematiche
    }
  }

  projects.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return projects.map(({ id, name, type }) => ({ id, name, type }));
}

// Ottiene il tipo di progetto (legge dal file; fallback: sceneggiatura)
async function getProjectType(projectId /* id cartella o legacy name */) {
  const projectPath = getProjectPathById(projectId);
  const typePath = path.join(projectPath, typeFileName);

  if (!(await fs.pathExists(typePath))) return 'sceneggiatura';

  const raw = (await fs.readFile(typePath, 'utf-8')).trim();
  return isValidType(raw) ? raw : 'sceneggiatura';
}

module.exports = {
  // paths
  getProjectPath,

  // core
  createProject,
  deleteProject,
  renameProject,
  listProjects,
  getProjectType,
  ensureProjectSections,

  // retrocompatibilità progetti
  migrateLegacyProject,

  // export util per allineare frontend se serve
  sectionsByType
};

