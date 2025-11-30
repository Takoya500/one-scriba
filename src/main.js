// ===== MAIN (versione stabile con zoom nativo come "View") =====
const path = require('path');
const fs = require('fs-extra');
const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');

const projectManager   = require('./backend/projectManager');
const exporter         = require('./backend/exporter');
const versionsManager  = require('./backend/versionsManager.js');
const autosave         = require('./backend/autosave.js');

let mainWindow;
// ——— Forza nome e cartella dati *coerenti* in dev e in build
const APP_DIR_NAME = 'One Scriba';
app.setName(APP_DIR_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_DIR_NAME));

// ---- Preferenze utente (lingua, zoom, ecc.) ----
const PREFERENCES_PATH = path.join(app.getPath('userData'), 'preferences.json');

function readPrefs() {
  try {
    const prefs = fs.readJsonSync(PREFERENCES_PATH, { throws: false }) || {};
    // Imposta l'inglese solo se non è ancora definita nessuna lingua
    if (!prefs.language) prefs.language = 'en';
    return prefs;
  } catch {
    // Se non esiste ancora il file preferenze, crea un default in inglese
    return { language: 'en' };
  }
}

function writePrefs(prefs) {
  try { fs.outputJsonSync(PREFERENCES_PATH, prefs, { spaces: 2 }); }
  catch (e) { console.warn('[prefs] write failed', e); }
}

/* =========================
   Zoom centralizzato (come View)
   ========================= */
const ZOOM = { MIN: 0.8, MAX: 2.0, STEP: 0.1, KEY: 'zoomFactor' };

function clampZoom(z) {
  return Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, z));
}
function getSavedZoom() {
  const prefs = readPrefs();
  return typeof prefs[ZOOM.KEY] === 'number' ? prefs[ZOOM.KEY] : 1.0;
}
function saveZoom(z) {
  const prefs = readPrefs();
  prefs[ZOOM.KEY] = clampZoom(z);
  writePrefs(prefs);
}
function applyZoom(win, factor) {
  const z = clampZoom(factor);
  win.webContents.setZoomFactor(z);
  saveZoom(z);
  win.webContents.send('zoom:changed', { factor: z });
}
function deltaZoom(win, delta) {
  const current = win.webContents.getZoomFactor();
  applyZoom(win, current + delta);
}
function resetZoom(win) {
  applyZoom(win, 1.0);
}

/* =========================
   Spell checker (segue lingua UI)
   ========================= */
const SPELL_LANGS = {
  it: ['it-IT'],
  en: ['en-US']
};

function normalizeLang(lang = '') {
  const v = String(lang || '').toLowerCase();
  if (v.startsWith('it')) return 'it';
  return 'en';
}

function applySpellLang(lang) {
  const key = normalizeLang(lang);
  const langs = SPELL_LANGS[key] || SPELL_LANGS.en;
  try {
    session?.defaultSession?.setSpellCheckerLanguages(langs);
  } catch (err) {
    console.warn('[spellcheck] Unable to set languages', err);
  }
}

/* =========================================================
   Helper export (filename sicuro, data ISO, labels, save dialog)
   ========================================================= */
function sanitizeFilename(name = '') {
  return String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim();
}
function isoStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm   = pad(d.getMonth() + 1);
  const dd   = pad(d.getDate());
  const HH   = pad(d.getHours());
  const MM   = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd} ${HH}.${MM}`;
}
function buildExportLabels(lang = 'it', projectType = '') {
  const L = (lang || 'it').toLowerCase().startsWith('en') ? 'en' : 'it';
  const SECTION_LABELS = {
    it: {
      scene:'Stesura', capitoli:'Stesura',
      concept:'Concept', soggetto:'Soggetto', trattamento:'Trattamento',
      scaletta:'Scaletta', bibbia:'Bibbia', personaggi:'Personaggi',
      timeline:'Timeline', note:'Note', outline:'Outline',
      soggetto_logline:'Soggetto & logline',
      didascalie:'Didascalie globali', premessa_sinossi:'Premessa & sinossi'
    },
    en: {
      scene:'Draft', capitoli:'Draft',
      concept:'Concept', soggetto:'Story Idea', trattamento:'Treatment',
      scaletta:'Outline', bibbia:'Bible', personaggi:'Characters',
      timeline:'Timeline', note:'Notes', outline:'Outline',
      soggetto_logline:'Story & logline',
      didascalie:'Global stage directions', premessa_sinossi:'Premise & synopsis'
    }
  };

  const sectionTitles = { ...(SECTION_LABELS[L] || SECTION_LABELS.it) };
  if (L === 'en' && projectType === 'libro') {
    sectionTitles.scaletta = 'Chapter Breakdown';
  }

  return {
    lang: L,
    projectType,
    page: L === 'en' ? 'Page' : 'Pagina',
    nonTextSectionsTitle: L === 'en' ? 'SECTIONS NOT EXPORTED' : 'SEZIONI NON ESPORTATE',
    nonTextSectionsNote:  L === 'en'
      ? 'These sections are not exported as text in this version:'
      : 'Queste sezioni non sono esportabili come testo nella versione attuale:',
    sectionTitles
  };
}
async function promptSavePDF({ suggestedName, defaultDir } = {}) {
  const res = await dialog.showSaveDialog({
    title: 'Esporta PDF',
    defaultPath: defaultDir ? path.join(defaultDir, suggestedName) : suggestedName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (res.canceled || !res.filePath) return null;
  return res.filePath.endsWith('.pdf') ? res.filePath : `${res.filePath}.pdf`;
}

/* ======================
   App window
   ====================== */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'backend', 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'frontend', 'welcome.html'));


  mainWindow.webContents.on('did-finish-load', () => {
    try {
      const z = getSavedZoom();
      applyZoom(mainWindow, z);
    } catch (e) {
      console.warn('Zoom restore failed:', e);
      applyZoom(mainWindow, 1.0);
    }
  });

  // Disabilita pinch-zoom
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

  // Emula View → Zoom In/Out/Reset
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    if (!mod) return;

    if (input.key === '=' || input.key === '+') { event.preventDefault(); deltaZoom(mainWindow, ZOOM.STEP); return; }
    if (input.key === '-' || input.key === '_') { event.preventDefault(); deltaZoom(mainWindow, -ZOOM.STEP); return; }
    if (input.key === '0')                      { event.preventDefault(); resetZoom(mainWindow); return; }
  });
}

app.whenReady().then(() => {
  // Assicurati che la root dati e la cartella progetti esistano
  const dataRoot = app.getPath('userData');
  fs.ensureDirSync(path.join(dataRoot, 'projects'));
  console.log('[One Scriba] userData:', dataRoot);

  try {
    const prefs = readPrefs();
    applySpellLang(prefs.language || 'en');
  } catch (err) {
    console.warn('[spellcheck] Initial sync failed', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* =========================
   IPC: Lingua
   ========================= */
ipcMain.handle('get-language', () => {
  const prefs = readPrefs();
  return prefs.language || null;
});
ipcMain.handle('set-language', (_evt, lang) => {
  const prefs = readPrefs();
  prefs.language = lang;
  writePrefs(prefs);
  applySpellLang(lang);
  return { success: true };
});
ipcMain.handle('set-spell-lang', (_evt, lang) => {
  applySpellLang(lang);
  return { success: true };
});

/* =========================
   Contenuti sezioni
   ========================= */
ipcMain.handle('load-content', async (_event, projectName, sectionName) => {
  try {
    const sectionPath = path.join(projectManager.getProjectPath(projectName), `${sectionName}.txt`);
    return await fs.readFile(sectionPath, 'utf-8');
  } catch {
    return '';
  }
});
ipcMain.handle('save-content', async (_event, content, projectName, sectionName) => {
  try {
    await autosave.saveContent(content, projectName, sectionName);
    console.log(`[${projectName} | ${sectionName}] Contenuto salvato.`);
    return { success: true };
  } catch (err) {
    console.error('❌ Errore salvataggio autosave:', err);
    return { success: false, error: err.message };
  }
});

/* =========================
   Progetti (ID-based)
   ========================= */
ipcMain.handle('create-project', async (_event, name, type = 'sceneggiatura') => {
  try {
    const id = await projectManager.createProject(name, type);
    return { success: true, id, name };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('list-projects', async () => {
  try {
    const list = await projectManager.listProjects();
    if (typeof projectManager.migrateLegacyProject === 'function') {
      for (const p of list) await projectManager.migrateLegacyProject(p.id);
    }
    return list;
  } catch (error) {
    console.warn('list-projects error:', error?.message || error);
    return [];
  }
});
ipcMain.handle('get-project-type', async (_event, name) => {
  try {
    const type = await projectManager.getProjectType(name);
    await projectManager.ensureProjectSections(name, type);
    return type;
  } catch {
    return 'sceneggiatura';
  }
});
ipcMain.handle('rename-project', async (_event, id, newName) => {
  try {
    await projectManager.renameProject(id, newName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('delete-project', async (_event, id) => {
  try {
    await projectManager.deleteProject(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/* =========================
   IPC Zoom (chiamati dal renderer)
   ========================= */
ipcMain.handle('zoom:get', () => ({ factor: getSavedZoom(), min: ZOOM.MIN, max: ZOOM.MAX, step: ZOOM.STEP }));
ipcMain.handle('zoom:set', (_e, factor) => {
  if (!mainWindow) return { success: false };
  applyZoom(mainWindow, Number(factor));
  return { success: true };
});
ipcMain.handle('zoom:delta', (_e, delta) => {
  if (!mainWindow) return { success: false };
  deltaZoom(mainWindow, Number(delta) || 0);
  return { success: true };
});
ipcMain.handle('zoom:reset', () => {
  if (!mainWindow) return { success: false };
  resetZoom(mainWindow);
  return { success: true };
});

/* =========================
   Esportazioni PDF
   ========================= */
ipcMain.handle('export-project', async (_event, projectName, sections) => {
  try {
    const prefs = readPrefs();
    const lang = prefs.language || 'it';
    let projectType = '';
    try {
      projectType = await projectManager.getProjectType(projectName);
    } catch {
      projectType = '';
    }
    const labels = buildExportLabels(lang, projectType);
    const lastKey = `lastExportDir_${projectName}`;
    const defaultDir = prefs[lastKey] || undefined;
    const suggested = sanitizeFilename(`${projectName} — Export ${isoStamp()}.pdf`);
    const filePath = await promptSavePDF({ suggestedName: suggested, defaultDir });
    if (!filePath) return { success: false, error: 'canceled' };
    const out = await exporter.exportProject(projectName, sections, 'pdf', filePath, labels);
    prefs[lastKey] = path.dirname(filePath);
    writePrefs(prefs);
    return { success: true, path: out };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('export-section', async (_event, projectName, sectionName) => {
  try {
    const prefs = readPrefs();
    const lang = prefs.language || 'it';
    let projectType = '';
    try {
      projectType = await projectManager.getProjectType(projectName);
    } catch {
      projectType = '';
    }
    const labels = buildExportLabels(lang, projectType);
    const lastKey = `lastExportDir_${projectName}`;
    const defaultDir = prefs[lastKey] || undefined;
    const shortLabel = labels.sectionTitles?.[sectionName] || sectionName;
    const suggested = sanitizeFilename(`${projectName} — ${shortLabel} — ${isoStamp()}.pdf`);
    const filePath = await promptSavePDF({ suggestedName: suggested, defaultDir });
    if (!filePath) return { success: false, error: 'canceled' };
    const out = await exporter.exportSectionPDF(projectName, sectionName, filePath, labels);
    prefs[lastKey] = path.dirname(filePath);
    writePrefs(prefs);
    return { success: true, path: out };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/* =========================
   Versioni (snapshot)
   ========================= */
ipcMain.handle('versions:list', async (_event, projectId) => {
  try { return await versionsManager.listVersions(projectId); }
  catch { return []; }
});
ipcMain.handle('versions:create', async (_event, projectId, opts = {}) => {
  try {
    const label = typeof opts === 'string' ? opts : (opts?.label || '');
    const v = await versionsManager.createVersion(projectId, { label });
    return { success: true, version: v };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('versions:restore', async (_event, projectId, versionId) => {
  try { await versionsManager.restoreVersion(projectId, versionId); return { success: true }; }
  catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('versions:delete', async (_event, projectId, versionId) => {
  try { await versionsManager.deleteVersion(projectId, versionId); return { success: true }; }
  catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('versions:rename', async (_event, projectId, versionId, newLabel) => {
  try {
    const v = await versionsManager.renameVersion(projectId, versionId, newLabel);
    return { success: true, version: v };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
