// editor.js - Logica editor Scriptum (COMPLETO aggiornato con fix sidebar + icone)
// ==================================================================================
// Mantiene tutte le funzionalità esistenti (timeline, personaggi, scaletta, bibbia,
// editor multipagina, toolbar, autosave) ed estende la sezione "scene" anche per
// il progetto di tipo "teatro". Include fix sidebar (riapertura) e icona progetto.
// + PATCH: sezioni personalizzate locali nelle card di Personaggi e Scaletta
// ==================================================================================

// --- Ponte Electron dal preload (niente require nel renderer)
const { ipcRenderer } = (window.electron || {});
// cleanup vecchio zoom CSS (se presente)
try { localStorage.removeItem('editorZoom'); } catch(_) {}
document.body.style.zoom = '';

// --- i18n helper (function: è hoistata e la puoi usare ovunque)
function T(k, fb = '') {
  const t = window.I18N?.t?.(k);
  // se la libreria ritorna la chiave stessa (o null/undefined) usa il fallback
  if (t == null || t === k) return fb;
  return t;
}

// --- inizializza lingua salvata dal main
async function initI18n() {
  try {
    const lang = ipcRenderer ? await ipcRenderer.invoke('get-language') : 'it';
    if (window.I18N?.setLang) {
      await window.I18N.setLang(lang || 'it');
      window.I18N.apply?.(document); // applica i data-i18n nell'HTML
    }
  } catch {
    // no-op
  }
}


// ID cartella del progetto (usato per leggere/scrivere file)
const projectName = localStorage.getItem('currentProject');
// Nome visuale pulito (fallback all'ID se manca)
const projectDisplayName = localStorage.getItem('currentProjectName') || projectName;
// — Sidebar “Sezioni” (nuova tendina)
const sectionsSplit     = document.getElementById('sectionsSplit');
const sectionsMainBtn   = document.getElementById('sectionsMainBtn');
const sectionsMenu      = document.getElementById('sectionsMenu');

/* =========================
   Sezioni — Disclosure “fisso” con stato persistente
   ========================= */
const sectionsDisclosureKey = `sectionsOpen_${projectName}`;

function openSectionsPanel() {
  if (!sectionsMenu || !sectionsMainBtn) return;
  sectionsMenu.hidden = false;
  sectionsMainBtn.setAttribute('aria-expanded', 'true');
  try { localStorage.setItem(sectionsDisclosureKey, 'open'); } catch(_) {}
}
function closeSectionsPanel() {
  if (!sectionsMenu || !sectionsMainBtn) return;
  sectionsMenu.hidden = true;
  sectionsMainBtn.setAttribute('aria-expanded', 'false');
  try { localStorage.setItem(sectionsDisclosureKey, 'closed'); } catch(_) {}
}
function toggleSectionsPanel() {
  if (!sectionsMenu) return;
  sectionsMenu.hidden ? openSectionsPanel() : closeSectionsPanel();
}
function handleSectionsTriggerKeydown(e) {
  const k = e.key;
  if (k === 'Enter' || k === ' ') { e.preventDefault(); toggleSectionsPanel(); }
}

// wire-up bottone “Sezioni”
if (sectionsSplit && sectionsMainBtn && sectionsMenu) {
  sectionsMainBtn.addEventListener('click', toggleSectionsPanel);
  sectionsMainBtn.addEventListener('keydown', handleSectionsTriggerKeydown);

  // ripristina stato salvato
  const saved = (localStorage.getItem(sectionsDisclosureKey) || 'open');
  if (saved === 'open') openSectionsPanel(); else closeSectionsPanel();
}

// Evidenziazione sezione attiva nella sidebar (dichiarazione "function" per essere hoistata)
function updateActiveSectionInSidebar() {
  if (!sectionsMenu) return;
  const items = sectionsMenu.querySelectorAll('.menu-item');
  items.forEach(it => {
    const active = it.dataset.section === currentSection;
    it.classList.toggle('is-active', active);
    if (active) it.setAttribute('aria-current', 'page');
    else it.removeAttribute('aria-current');
  });
}

// (rimosso: sectionButtons non esiste più nell’HTML)
const editorArea = document.getElementById('editorArea');
const readOnlyBtn = document.getElementById('readOnlyBtn');
const editorContainer = document.getElementById('editorContainer');
const modeSelector = document.getElementById('modeSelector');
const writingMode = document.getElementById('writingMode');
const formatToolbar = document.getElementById('formatToolbar');
// Pulsanti zoom
const zoomInBtn  = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');

// --- Sidebar chrome (nome progetto / toggle)
const layoutRoot     = document.getElementById('layoutRoot');
const sidebar        = document.getElementById('sidebar');
const sidebarToggle  = document.getElementById('sidebarToggle');
const projectNameEl  = document.getElementById('projectName');
const projectIconEl  = document.getElementById('projectIcon');

// --- GAP tra modalità Scene ---
let lastSceneMode = null;
let sceneGapPending = false;
let writingModeListenerAttached = false;

/* ----- Timeline: riferimenti DOM ----- */
const tlToolbar = document.getElementById('timelineToolbar');
const tlContainer = document.getElementById('timelineContainer');
const tlViewport = document.getElementById('timelineViewport');
const tlTrack = document.getElementById('timelineTrack');
const tlAddEventBtn = document.getElementById('tlAddEvent');
const tlZoomOutBtn = document.getElementById('tlZoomOut');
const tlZoomInBtn = document.getElementById('tlZoomIn');
const tlZoomDisplay = document.getElementById('tlZoomDisplay');

let currentSection = '';
let projectType = '';
let sections = [];
let isReadOnly = false;
/* ========== Utilità ========== */
function debounce(fn, delay = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}
// Debounce specifici per sezioni strutturate
const debouncedSaveBible = debounce(() => saveBible(), 1000);
const debouncedSaveOutline = debounce(() => saveOutline(), 1000);
const debouncedSaveCharacters = debounce(() => saveCharacters(), 1000);

/* (RIMOSSO) ========== Icone progetto (fallback per tipo) ========== */
/* Nota: tutta la gestione icone è stata eliminata come richiesto. */

/* ====== Sidebar: init nome, stato tendina (toggle sempre cliccabile) ====== */
function initSidebarChrome() {
  // Titolo progetto (solo testo, niente icona)
 if (projectNameEl) projectNameEl.textContent = projectDisplayName || 'Progetto';

  // Stato sidebar open/closed persistito per progetto
  const key = `sidebarState_${projectName}`;
  const savedState = (localStorage.getItem(key) === 'closed') ? 'closed' : 'open';
  if (layoutRoot) layoutRoot.setAttribute('data-sidebar-state', savedState);

  // Toggle sempre visibile (posizionato fuori dalla sidebar in HTML/CSS)
  if (sidebarToggle) {
const syncA11y = (state) => {
  const isOpen = state === 'open';
  const label = isOpen ? T('editor.sidebar.close','Chiudi barra')
                       : T('editor.sidebar.open','Apri barra');
  sidebarToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  sidebarToggle.setAttribute('aria-label', label);
  sidebarToggle.title = label;
};


    syncA11y(savedState);

    sidebarToggle.addEventListener('click', () => {
      const current = (layoutRoot?.getAttribute('data-sidebar-state') === 'closed') ? 'closed' : 'open';
      const next = current === 'open' ? 'closed' : 'open';
      layoutRoot?.setAttribute('data-sidebar-state', next);
      localStorage.setItem(key, next);
      syncA11y(next);

      // Ripaginazione per mantenere centratura nelle sezioni testuali
      if (isClassicTextSection()) debouncedRepaginateWithCaret();
    });
  }
}

/* Helpers sezione corrente */
const isTimelineSection    = () => currentSection === 'timeline';
const isCharactersSection  = () => currentSection === 'personaggi';
const isOutlineSection     = () => currentSection === 'scaletta';
const isBibleSection       = () => currentSection === 'bibbia';
const isClassicTextSection = () =>
  !isTimelineSection() && !isCharactersSection() && !isOutlineSection() && !isBibleSection();

// Flag: controlla se siamo in scena Teatro/Cinema
function isSceneTheatre()     { return currentSection === 'scene' && projectType === 'teatro'; }
function isSceneScreenplay()  { return currentSection === 'scene' && projectType === 'sceneggiatura'; }

// =============================
// Modalità di scrittura (multilingua)
// =============================
const SCREENPLAY_MODES = [
  { v: 'scene-heading', label: T('editor.mode.sceneHeading', 'Scene Heading') },
  { v: 'action',        label: T('editor.mode.action', 'Action') },
  { v: 'character',     label: T('editor.mode.character', 'Character') },
  { v: 'dialogue',      label: T('editor.mode.dialogue', 'Dialogue') },
  { v: 'parenthetical', label: T('editor.mode.parenthetical', 'Parenthetical') },
  { v: 'transition',    label: T('editor.mode.transition', 'Transition') }
];

const THEATRE_MODES = [
  { v: 'scene-heading',   label: T('editor.mode.theatre.scene', 'Scene') },
  { v: 'character',       label: T('editor.mode.character', 'Character') },
  { v: 'dialogue',        label: T('editor.mode.dialogue', 'Dialogue') },
  { v: 'stage-direction', label: T('editor.mode.theatre.stageDirection', 'Stage direction') }
];


function createSceneLine(mode, html='&nbsp;') {
  const el = document.createElement('div');
  el.className = mode;
  el.setAttribute('contenteditable', 'true');
  el.innerHTML = html;
  return el;
}

/* =========================
   Etichetta sezione (i18n) — usa editor.sectionTitles.*
   ========================= */
function getSectionLabel(section) {
  const fb = {
    // scrittura principale
    scene:    'Stesura',
    capitoli: 'Stesura',

    // comuni
    concept:     'Concept',
    soggetto:    'Soggetto',
    trattamento: 'Trattamento',
    scaletta:    'Scaletta',
    bibbia:      'Bibbia',
    personaggi:  'Personaggi',
    timeline:    'Timeline',
    note:        'Note',

    // libro
    outline:          'Outline',
    soggetto_logline: 'Soggetto & logline',

    // teatro
    didascalie:       'Didascalie globali',
    premessa_sinossi: 'Premessa & sinossi'
  };

  if (section === 'scaletta' && projectType === 'libro') {
    const currentLang = (window.I18N?.lang || 'it').toLowerCase();
    if (currentLang.startsWith('en')) {
      return T('editor.sectionTitles.scaletta_book', 'Chapter Breakdown');
    }
  }

  // Chiave allineata ai file it/en:
  // { "editor": { "sectionTitles": { "<section>": "..." } } }
  return T(
    `editor.sectionTitles.${section}`,
    fb[section] || section.charAt(0).toUpperCase() + section.slice(1)
  );
}

/* (opzionale) se cambi lingua a runtime e vuoi aggiornare le voci già montate */
function refreshSectionLabels() {
  if (!sectionsMenu) return;
  sectionsMenu.querySelectorAll('.menu-item').forEach(it => {
    const s = it.dataset.section;
    it.textContent = getSectionLabel(s);
  });
}

/* =========================
   Caricamento tipo progetto + sezioni
   ========================= */
async function loadProjectType() {
  projectType = await ipcRenderer.invoke('get-project-type', projectName);

  const sectionsByType = {
    sceneggiatura: [
      // Stesura in cima (ID interno invariato)
      'scene',
      // — resto
      'concept','soggetto','trattamento','scaletta','bibbia',
      'personaggi','timeline','note'
    ],
    libro: [
      // Stesura in cima (ID interno invariato)
      'capitoli',
      // — resto
      'soggetto_logline','outline','scaletta','bibbia',
      'personaggi','timeline','note'
    ],
    teatro: [
      // Stesura in cima (ID interno invariato)
      'scene',
      // — resto
      'premessa_sinossi','scaletta','bibbia',
      'personaggi','didascalie','timeline','note'
    ]
  };

  // Elenco sezioni per il tipo progetto
  sections = sectionsByType[projectType] || sectionsByType.sceneggiatura;

  // Popola la lista del disclosure “Sezioni”
  if (sectionsMenu) {
    sectionsMenu.innerHTML = '';

    sections.forEach(section => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'menu-item';
      item.dataset.section = section;
      item.textContent = getSectionLabel(section);

      // Disclosure “fisso”: non chiudiamo il pannello al click
      item.addEventListener('click', () => {
        loadSection(section);
      });

      sectionsMenu.appendChild(item);
    });

    // Ripristina stato aperto/chiuso del disclosure per progetto
    const disclosureKey = `sectionsOpen_${projectName}`;
    const saved = (localStorage.getItem(disclosureKey) || 'open');
    const isOpen = saved === 'open';
    sectionsMenu.hidden = !isOpen;
    if (sectionsMainBtn) sectionsMainBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  } // <-- chiude if (sectionsMenu)

  // Carica ultima sezione visitata (fallback: prima disponibile)
  const lastSection = localStorage.getItem(`lastSection_${projectName}`);
  if (lastSection && sections.includes(lastSection)) {
    loadSection(lastSection);
  } else if (sections.length > 0) {
    loadSection(sections[0]);
  }

  // Evidenziazione iniziale nella lista “Sezioni”
  updateActiveSectionInSidebar();
} // <-- chiude function loadProjectType()


/* =========================
   Carica sezione + viste
   ========================= */
async function loadSection(section) {
  currentSection = section;
  localStorage.setItem(`lastSection_${projectName}`, section);
  updateActiveSectionInSidebar();

  // Nuovo: riconosciamo "scene" per cinema o teatro
  const isScene = section === 'scene';
  const isSceneCinema  = isScene && projectType === 'sceneggiatura';
  const isSceneTeatro  = isScene && projectType === 'teatro';

  const isTimeline = isTimelineSection();
  const isCharacters = isCharactersSection();
  const isOutline = isOutlineSection();
  const isBible = isBibleSection();

 // Selettore modalità (solo Scene)
 if (modeSelector) modeSelector.style.display = isScene ? 'block' : 'none';
 editorContainer.classList.toggle('scene-mode', isScene);


  // Toolbar testuale: OFF per scene/timeline/personaggi/scaletta/bibbia
  const hideToolbar = isScene || isTimeline || isCharacters || isOutline || isBible;
  editorContainer.classList.toggle('hide-toolbar', hideToolbar);
  if (formatToolbar) formatToolbar.style.display = hideToolbar ? 'none' : 'flex';

  // --- GAP tra modalità Scene ---
  if (isScene && writingMode) {
    lastSceneMode = writingMode.value || null;
    sceneGapPending = false;

    if (!writingModeListenerAttached) {
      writingMode.addEventListener('change', () => {
        if (currentSection !== 'scene') return; // solo sezione Scene
        const newMode = writingMode.value || null;
        if (lastSceneMode && newMode && newMode !== lastSceneMode) {
          sceneGapPending = true; // la prossima volta che premi Invio aggiunge una riga vuota
        }
        lastSceneMode = newMode;
      });
      writingModeListenerAttached = true;
    }
  }

// ====== TIMELINE ======
if (isTimeline) {
  editorArea.style.display = 'none';
  if (tlToolbar) tlToolbar.style.display = 'flex';
  if (tlContainer) tlContainer.style.display = 'flex';
  destroyCharactersUI();
  destroyOutlineUI();
  destroyBibleUI();

  await loadTimeline();
  initTimelineUI();
  renderTimeline();

  
// --- Offset fine-centro (px): + giù, - su
const TL_CENTER_OFFSET = -10;

// Centra la timeline usando l'altezza effettiva del track (post-zoom)
function centerTimeline({ defer = 0 } = {}) {
  setTimeout(() => {
    const vp = tlViewport;
    const track = tlTrack;
    if (!vp || !track) return;

    // reset margine eventuale
    track.style.marginTop = '0px';

    const vpH    = vp.clientHeight || 0;
    // altezza effettiva dopo lo zoom (rettangolo visivo)
    const trackH = track.getBoundingClientRect().height || track.scrollHeight || track.offsetHeight || 0;

    if (trackH > vpH + 1) {
      // overflow: centro via scrollTop (metà contenuto meno metà viewport)
      const target = (trackH - vpH) / 2 + TL_CENTER_OFFSET;
      vp.scrollTop = Math.max(0, Math.round(target));
    } else {
      // nessun overflow: centro con margine superiore
      const extraTop = Math.max(0, Math.round((vpH - trackH) / 2 + TL_CENTER_OFFSET));
      track.style.marginTop = extraTop + 'px';
    }
  }, defer);
}

  centerTimeline();             // subito dopo il primo render
  setTimeout(centerTimeline, 120); // secondo pass per layout/font

  setTimeout(() => {
    if (tlTrack && tlTrack.children.length === 0 && timelineData.length) {
      renderTimeline();
    }// --- Offset fine-centro (px): + giù, - su
    centerTimeline();           // ricentra dopo l’eventuale re-render
  }, 80);

  applyTimelineReadOnly();
  return;
} else {
  if (tlToolbar) tlToolbar.style.display = 'none';
  if (tlContainer) tlContainer.style.display = 'none';
}
  
  // ====== PERSONAGGI ======
  if (isCharacters) {
    editorArea.style.display = 'flex';
    editorArea.innerHTML = '';
    destroyOutlineUI();
    destroyBibleUI();
    buildCharactersUI();
    await loadCharacters();
    renderCharacters();
    applyReadOnlyStateCharacters();
    return;
  } else {
    destroyCharactersUI();
  }


  // ====== SCALETTA ======
  if (isOutline) {
    editorArea.style.display = 'flex';
    editorArea.innerHTML = '';
    destroyCharactersUI();
    destroyBibleUI();
    buildOutlineUI();
    await loadOutline();
    renderBeats();
    applyReadOnlyStateOutline();
    return;
  } else {
    destroyOutlineUI();
  }

  // ====== BIBBIA ======
  if (isBible) {
    editorArea.style.display = 'flex';
    editorArea.innerHTML = '';
    destroyCharactersUI();
    destroyOutlineUI();
    buildBibleUI();
    await loadBible();
    ensureBibleDefaults(); // merge + rimozione definitiva di "meta"
    renderBible();
    applyReadOnlyStateBible();
    return;
  } else {
    destroyBibleUI();
  }

  // ====== Sezioni testuali classiche ======
  editorArea.style.display = 'flex';

// =============================
// Popola le modalità con scorciatoie visibili
// =============================
if (section === 'scene' && writingMode) {
  writingMode.innerHTML = '';

  // 🔹 Mappa scorciatoie per ogni modalità
  const shortcutsMap = (projectType === 'teatro')
    ? {
        'scene-heading':  'Ctrl + 1',
        'character':      'Ctrl + 2',
        'dialogue':       'Ctrl + 3',
        'stage-direction':'Ctrl + 4'
      }
    : {
        'scene-heading':  'Ctrl + 1',
        'action':         'Ctrl + 2',
        'character':      'Ctrl + 3',
        'dialogue':       'Ctrl + 4',
        'parenthetical':  'Ctrl + 5',
        'transition':     'Ctrl + 6'
      };

  const modes = (projectType === 'teatro') ? THEATRE_MODES : SCREENPLAY_MODES;

  for (const m of modes) {
    const o = document.createElement('option');
    o.value = m.v;

    // Mostra scorciatoia accanto, separata da uno spazio largo
    const shortcut = shortcutsMap[m.v] ? `   |   ${shortcutsMap[m.v]}` : '';
    o.textContent = `${m.label}${shortcut}`;
    writingMode.appendChild(o);
  }

// Valore iniziale di default → solo se la sezione è vuota
const hasSceneBlocks = !!editorArea.querySelector('.page-content div');
if (!hasSceneBlocks) {
  writingMode.value = (projectType === 'teatro') ? 'dialogue' : 'action';
}

}





// =============================
// 🔹 CARICAMENTO CONTENUTO (fix definitivo liste/bullet)
// =============================
try {
  let content = '';
  try {
    content = await ipcRenderer.invoke('load-content', projectName, currentSection);
    if (!content || !content.trim()) content = '';
  } catch (e) {
    console.warn('Nessun contenuto trovato per', currentSection, e);
    content = '';
  }

// ✅ Solo le sezioni testuali vanno “normalizzate” per l’editor (no scene!)
if (isClassicTextSection() && currentSection !== 'scene') {
  content = restoreListsForEditor(content);
}


// 🔹 Mostra il contenuto in pagina (scene rimane intatta con le sue classi)
paginateFromHTML(content || '');
// ✅ Ripristina riga vuota tra i blocchi scena
if (currentSection === 'scene') {
  const pages = editorArea.querySelectorAll('.page-content');
  pages.forEach(page => {
    const blocks = Array.from(page.children);
    for (let i = 0; i < blocks.length - 1; i++) {
      const current = blocks[i];
      const next = blocks[i + 1];
      if (!current.classList.contains('scene-gap') && !next.classList.contains('scene-gap')) {
        const gap = document.createElement('div');
        gap.className = 'scene-gap';
        current.insertAdjacentElement('afterend', gap);
      }
    }
  });
}

  addPageNumbers();
  applyReadOnlyState();
  
// --- PATCH: placeholder iniziale per sezioni testuali ---
if (isClassicTextSection()) {
  const firstPage = editorArea.querySelector('.page:first-child .page-content');
  if (firstPage) {
    const ph = T('editor.placeholder.start', 'Inizia a scrivere…');
    firstPage.setAttribute('data-placeholder', ph);

    // Se vuoto all'avvio → mostra placeholder
    if (!firstPage.textContent.trim()) {
      firstPage.classList.add('is-empty');
      firstPage.innerHTML = ''; // garantisce area cliccabile
    }

    // 🔹 Rimuovi placeholder appena l’utente scrive qualcosa
    firstPage.addEventListener('input', () => {
      const empty = !firstPage.textContent.trim();
      firstPage.classList.toggle('is-empty', empty);
    });
  }
}




  // Teatro: se l’ultima pagina è vuota, lasciala così (nessun contenuto di default)
  if (isSceneTeatro) {
    const lastPageContent = editorArea.querySelector('.page:last-child .page-content');
    const isEmpty = lastPageContent && !lastPageContent.textContent.trim();
    if (isEmpty) {
      // no-op
    }
  }

} catch (err) {
  console.error('Errore nel caricamento contenuto:', err);
  paginateFromHTML('');
  addPageNumbers();
  applyReadOnlyState();
}

updateToolbarState();
updateToolbarEnabled();



}

// ======================================================
// GESTIONE LISTE — versione stabile per export PDF
// ======================================================

// ✅ Versione finale — riconosce e pulisce sia liste puntate che numerate
function normalizeListsForSave(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  // Se ci sono già <ul>/<ol>, li manteniamo
  if (tmp.querySelector('ul, ol')) {
    return tmp.innerHTML;
  }

  const lines = tmp.innerHTML.split(/<\/div>|<\/p>/i).filter(l => l.trim());
  const out = [];
  let inList = false;
  let isOrdered = false;

  for (let line of lines) {
    const text = line.replace(/<[^>]+>/g, '').trim();
    const bullet = /^(?:•|-|\*|–)\s+/.test(text);
    const numMatch = /^(\d{1,5})[.)]\s+/.exec(text);

    if (bullet || numMatch) {
      const tag = numMatch ? 'ol' : 'ul';

      // Apri una nuova lista se necessario
      if (!inList || isOrdered !== !!numMatch) {
        if (inList) out.push(`</${isOrdered ? 'ol' : 'ul'}>`);
        out.push(`<${tag}>`);
        inList = true;
        isOrdered = !!numMatch;
      }

      // 🔹 Pulisci il bullet/numero dal testo originale
      const clean = line
        .replace(/^\s*(?:•|-|\*|–|\d{1,5}[.)])\s*/, '')
        .trim();

      out.push(`<li>${clean}</li>`);
    } else {
      if (inList) {
        out.push(`</${isOrdered ? 'ol' : 'ul'}>`);
        inList = false;
      }
      // 🔹 Avvolge il testo normale in <p>
      const cleanText = line.replace(/^<div[^>]*>|<\/div>$/g, '').trim();
      if (cleanText) out.push(`<p>${cleanText}</p>`);
    }
  }

  if (inList) out.push(`</${isOrdered ? 'ol' : 'ul'}>`);

  return out.join('\n').replace(/\u00A0/g, ' ').trim();
}


// ✅ Mantiene le liste inalterate al caricamento (idempotente e sicuro)
function restoreListsForEditor(html) {
  if (!html) return '';

  // Se l'HTML contiene già liste vere, non lo tocchiamo
  if (/<ul|<ol/i.test(html)) {
    return html;
  }

  // Solo se NON ci sono liste vere, prova a correggere bullet testuali
  return html
    .replace(/<div>(\s*•|\s*◦|\s*-\s*|\s*\*\s*|\s*\d+\.)\s*/g, '<li>')
    .replace(/<\/div>/g, '</li>')
    .replace(/<\/li>\s*<li>/g, '</li><li>')
    .replace(/<\/li>\s*<\/li>/g, '</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/<\/ul>\s*<\/ul>/g, '</ul>')
    .replace(/<\/ol>\s*<\/ol>/g, '</ol>');
}





// ✅ Salvataggio sicuro — mantiene le liste vere <ul>/<ol>/<li>
function saveSection() {
  if (!currentSection || isReadOnly) return;

  // Sezioni speciali gestite separatamente
  if (isTimelineSection())   { saveTimeline();   return; }
  if (isCharactersSection()) { if (typeof saveCharacters === 'function') saveCharacters(); return; }
  if (isOutlineSection())    { saveOutline();    return; }
  if (isBibleSection())      { saveBible();      return; }

// Unisci il contenuto di tutte le pagine
const pages = Array.from(editorArea.querySelectorAll('.page-content'));
let html;

// 🔹 Per la Stesura e i Capitoli NON normalizziamo le liste,
//    così restano intatte le classi da sceneggiatura
if (currentSection === 'scene' || currentSection === 'capitoli') {
  html = pages.map(pc => pc.innerHTML.trim()).join('\n');
} else {
  html = pages.map(pc => normalizeListsForSave(pc.innerHTML.trim())).join('\n');
}

// 🔹 Forza encoding UTF-8 senza caratteri strani
let cleanHTML = html.replace(/\uFEFF/g, '').trim();

if (currentSection === 'didascalie') {
  cleanHTML = cleanHTML
    .replace(/<div[^>]*class="scene-gap"[^>]*>(?:\s|&nbsp;|&#160;)*<\/div>/gi, '')
    .replace(/<(?:p|div)(?:\s[^>]*)?>\s*(?:&nbsp;|&#160;|\s)*<\/(?:p|div)>/gi, '');
}

// 🩵 FIX: sezione “scene” — ignora placeholder e linee vuote ma salva i blocchi effettivi
if (currentSection === 'scene') {
  const pages = Array.from(editorArea.querySelectorAll('.page-content'));
  const realBlocks = pages
    .map(pc => {
      // Se non ci sono figli, considera testo diretto (fallback)
      if (!pc.children.length) return pc.textContent.trim();
      // Se ci sono <div> (righe), salva solo quelle con contenuto reale
      const blocks = Array.from(pc.children)
        .filter(div => div.textContent.trim() && !div.classList.contains('scene-gap'))
        .map(div => div.outerHTML.trim());
      return blocks.join('\n');
    })
    .filter(x => x && x.trim().length > 0);
  cleanHTML = realBlocks.join('\n');
}


// 🔹 Usa invoke (asincrono e sicuro)
ipcRenderer.invoke('save-content', cleanHTML, projectName, currentSection)
  .then(() => {
    console.log(`[${projectName} | ${currentSection}] Contenuto salvato.`);
  })
  .catch(err => console.error('Errore nel salvataggio sezione:', err));
}



/* =========================
   Paginazione multipagina
   ========================= */
function createEmptyPage() {
  const page = document.createElement('div');
  page.className = 'page';
  page.tabIndex = -1;

  const pageContent = document.createElement('div');
  pageContent.className = 'page-content';
  pageContent.setAttribute('contenteditable', 'true');

  const pageNumber = document.createElement('div');
  pageNumber.className = 'page-number';
  pageNumber.setAttribute('contenteditable', 'false');

  page.appendChild(pageContent);
  page.appendChild(pageNumber);
  return { page, pageContent, pageNumber };
}

function htmlToBlocks(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html && html.trim() ? html : '';

  // Se vuoto, restituisci un blocco base
  if (!tmp.childNodes.length) {
    const empty = document.createElement('div');
    empty.innerHTML = '&nbsp;';
    return [empty];
  }

  // 🔹 SCENE: preserva classi e assegna automaticamente "action" se mancante
  if (currentSection === 'scene') {
    return Array.from(tmp.children).map(node => {
      if (node.nodeType === Node.ELEMENT_NODE && !node.className) {
        node.classList.add('action'); // blocchi senza classe → azione
      }
      return node;
    });
  }

  // Altre sezioni: conversione standard
  const blocks = [];
  Array.from(tmp.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const div = document.createElement('div');
      div.textContent = node.textContent;
      blocks.push(div);
    } else {
      blocks.push(node);
    }
  });

  return blocks;
}


function paginateFromHTML(html) {
  editorArea.innerHTML = '';

  const blocks = htmlToBlocks(html);
  let { page, pageContent } = createEmptyPage();
  editorArea.appendChild(page);

  blocks.forEach(block => {
    pageContent.appendChild(block);
    if (pageContent.scrollHeight > pageContent.clientHeight + 1) {
      pageContent.removeChild(block);
      const next = createEmptyPage();
      editorArea.appendChild(next.page);
      page = next.page;
      pageContent = next.pageContent;
      pageContent.appendChild(block);
    }
  });
}

function addPageNumbers() {
  const pages = editorArea.querySelectorAll('.page');
  pages.forEach((p, i) => {
    const footer = p.querySelector('.page-number');
if (footer) footer.textContent = `${T('editor.page','Pagina')} ${i + 1}`;
  });
}

/* =========================
   Caret anchoring
   ========================= */
const CARET_ID = '__scriptum_caret_anchor__';

function insertCaretAnchor() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0).cloneRange();
  const span = document.createElement('span');
  span.id = CARET_ID;
  span.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;';
  range.insertNode(span);
  range.setStartAfter(span);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}
function restoreCaretFromAnchor() {
  const marker = document.getElementById(CARET_ID);
  if (!marker) return;
  const range = document.createRange();
  const sel = window.getSelection();
  range.setStartAfter(marker);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  marker.remove();
}

/* Ripaginazione smart */
function getCurrentPageContentFromSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node = sel.anchorNode;
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  return node.closest ? node.closest('.page-content') : null;
}
function shouldRepaginate() {
  const pages = editorArea.querySelectorAll('.page');
  if (pages.length === 0) return true;
  const pc = getCurrentPageContentFromSelection();
  if (!pc) return false;
  const overflow = pc.scrollHeight > pc.clientHeight + 1;
  if (overflow) return true;
  const lastPc = editorArea.querySelector('.page:last-child .page-content');
  if (lastPc && pages.length > 1) {
    const text = lastPc.innerText.replace(/\s|\u00A0/g, '');
    if (text.length === 0) return true;
  }
  return false;
}
const repaginateWithCaret = () => {
  if (!isClassicTextSection()) return;
  const hadAnchor = insertCaretAnchor();
  const scrollTop = editorArea.scrollTop;
  const html = Array.from(editorArea.querySelectorAll('.page-content'))
    .map(pc => pc.innerHTML)
    .join('');
  paginateFromHTML(html);
  addPageNumbers();
  applyReadOnlyState();
  if (hadAnchor) restoreCaretFromAnchor();
  editorArea.scrollTop = scrollTop;
};
const debouncedRepaginateWithCaret = debounce(repaginateWithCaret, 140);

/* === INVIO nelle Scene ===
   Inserisce SEMPRE una riga vuota (gap) + poi una riga del tipo selezionato, al cursore */
editorArea.addEventListener('keypress', function (e) {
  const isScene = currentSection === 'scene';
  if (!isScene || isReadOnly || e.key !== 'Enter') return;

  e.preventDefault();

  const mode = (writingMode && writingMode.value) ? writingMode.value : 'dialogue';

  // Trova pagina e blocco sotto il cursore
  const sel = window.getSelection && window.getSelection();
  let node = sel && sel.rangeCount ? sel.anchorNode : null;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;

  let pageContent = null;
  let currentBlock = null;

  if (node && node.closest) {
    pageContent = node.closest('.page-content');
    currentBlock = node.closest('.page-content > div'); // il blocco "linea" corrente
  }

  // Fallback: se non siamo dentro page-content, usa/crea l’ultima
  if (!pageContent) {
    pageContent = editorArea.querySelector('.page:last-child .page-content');
    if (!pageContent) {
      const { page, pageContent: pc } = createEmptyPage();
      editorArea.appendChild(page);
      pageContent = pc;
    }
  }

  // Punto d'inserimento: subito dopo il blocco corrente (se esiste), altrimenti in coda
  const afterNode = currentBlock ? currentBlock.nextSibling : null;

  // GAP: riga vuota
  const gap = document.createElement('div');
  gap.className = 'scene-gap';
  gap.setAttribute('contenteditable', 'true');
  gap.innerHTML = '&nbsp;';
  pageContent.insertBefore(gap, afterNode);

  // azzera flag gap su cambio modalità
  sceneGapPending = false;

  // Nuova riga del tipo selezionato
  const newLine = document.createElement('div');
  newLine.className = mode;
  newLine.setAttribute('contenteditable', 'true');
  newLine.innerHTML = (mode === 'parenthetical') ? '(<span id="cursor">&#8203;</span>)' : '&nbsp;';
  pageContent.insertBefore(newLine, afterNode);

  if (shouldRepaginate()) debouncedRepaginateWithCaret();

  // Metti il cursore nella nuova riga
  setTimeout(() => {
    const cursorSpan = document.getElementById('cursor');
    if (cursorSpan) {
      const range = document.createRange(); const s = window.getSelection();
      range.setStart(cursorSpan, 0); range.collapse(true);
      s.removeAllRanges(); s.addRange(range);
      cursorSpan.remove();
    } else {
      placeCaretAtEnd(newLine);
    }
  }, 0);
});

editorArea.addEventListener('paste', () => {
  if (!isClassicTextSection()) return;
  debouncedRepaginateWithCaret();
});
window.addEventListener('resize', debounce(() => {
  if (!isClassicTextSection()) return;
  repaginateWithCaret();
}, 200));

function placeCaretAtEnd(el) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/* =========================
   Toolbar testuale
   ========================= */
function focusCurrentEditor() {
  const sel = window.getSelection();
  let pc = null;
  if (sel && sel.rangeCount) {
    let node = sel.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    if (node && node.closest) pc = node.closest('.page-content');
  }
  if (!pc) pc = editorArea.querySelector('.page-content');
  if (pc) pc.focus();
  return pc;
}
function exec(cmd, value = null) {
  if (isReadOnly || editorContainer.classList.contains('hide-toolbar')) return;
  focusCurrentEditor();

  if (cmd === 'decreaseFont') { document.execCommand('fontSize', false, 2); updateToolbarState(); return; }
  if (cmd === 'normalFont')   { document.execCommand('fontSize', false, 3); updateToolbarState(); return; }
  if (cmd === 'increaseFont') { document.execCommand('fontSize', false, 4); updateToolbarState(); return; }
  if (cmd === 'undo' || cmd === 'redo') {
    document.execCommand(cmd, false, null);
    updateToolbarState();
    return;
  }
  document.execCommand(cmd, false, value);
  updateToolbarState();
}
if (formatToolbar) {
  formatToolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tb-btn');
    if (!btn || btn.disabled) return;
    const cmd = btn.dataset.cmd;
    const value = btn.dataset.value || null;
    exec(cmd, value);
  });
  document.addEventListener('selectionchange', debounce(updateToolbarState, 100));
}
function updateToolbarState() {
  if (!formatToolbar) return;
  ['bold','italic','underline','insertUnorderedList','insertOrderedList'].forEach(cmd => {
    let state = false;
    try { state = document.queryCommandState(cmd); } catch (_) {}
    const btn = formatToolbar.querySelector(`.tb-btn[data-cmd="${cmd}"]`);
    if (btn) btn.setAttribute('aria-pressed', state ? 'true' : 'false');
  });
  let v = null;
  try { v = document.queryCommandValue('fontSize'); } catch (_) {}
  const map = { '2': 'decreaseFont', '3': 'normalFont', '4': 'increaseFont' };
  ['decreaseFont','normalFont','increaseFont'].forEach(c => {
    const b = formatToolbar.querySelector(`.tb-btn[data-cmd="${c}"]`);
    if (b) b.setAttribute('aria-pressed','false');
  });
  if (v && map[v]) {
    const active = formatToolbar.querySelector(`.tb-btn[data-cmd="${map[v]}"]`);
    if (active) active.setAttribute('aria-pressed','true');
  }
}

/* Read-only stati comuni */
function applyReadOnlyState() {
  const pcs = editorArea.querySelectorAll('.page-content');
  pcs.forEach(pc => pc.setAttribute('contenteditable', String(!isReadOnly)));
  updateToolbarEnabled();
}
function updateToolbarEnabled() {
  if (!formatToolbar) return;
  const disabled = isReadOnly || editorContainer.classList.contains('hide-toolbar');
  formatToolbar.querySelectorAll('.tb-btn').forEach(b => {
    b.disabled = disabled;
    b.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  });
}
function toggleReadOnly() {
  isReadOnly = !isReadOnly;
  applyReadOnlyState();
  applyTimelineReadOnly();
  applyReadOnlyStateCharacters();
  applyReadOnlyStateOutline();
  applyReadOnlyStateBible();
if (readOnlyBtn) {
  readOnlyBtn.innerHTML = isReadOnly ? UNLOCKED_SVG : LOCKED_SVG;
  readOnlyBtn.setAttribute('aria-label', isReadOnly
    ? T('editor.edit','Modifica')
    : T('editor.readonly','Solo lettura'));
  readOnlyBtn.setAttribute('title', isReadOnly
    ? T('editor.edit','Modifica')
    : T('editor.readonly','Solo lettura'));
}
}
function toggleTheme() {
  const body = document.body;
  const isDark = body.classList.contains('dark');
  const newTheme = isDark ? 'light' : 'dark';
  body.classList.remove('light', 'dark');
  body.classList.add(newTheme);
  localStorage.setItem('uiTheme', newTheme); // ✅ memorizza la scelta
}

/* =========================
   Zoom (delegato al Main come "View")
   ========================= */
const Z_STEP = 0.1;

async function rendererZoomDelta(delta) {
  try {
    await ipcRenderer.invoke('zoom:delta', delta);
  } catch (_) {}
}

async function rendererZoomReset() {
  try {
    await ipcRenderer.invoke('zoom:reset');
  } catch (_) {}
}

// Pulsanti UI
if (zoomInBtn)  zoomInBtn.addEventListener('click',  () => rendererZoomDelta(+Z_STEP));
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => rendererZoomDelta(-Z_STEP));

// (Facoltativo) ascolta i cambi di zoom dal Main
if (ipcRenderer && typeof ipcRenderer.on === 'function') {
  ipcRenderer.on('zoom:changed', (_e, { factor }) => {
    // Se vuoi, puoi aggiornare elementi dell’interfaccia in base allo zoom
    console.log('Zoom attuale:', factor);
  });
}


/* Export / Navigazione */
let __exportBusy = false; // guardia anti doppio click

async function exportFullPDF() {
  if (__exportBusy) return;
  __exportBusy = true;
  try {
    const result = await ipcRenderer.invoke('export-project', projectName, sections);
    if (result && result.success) {
      showToast(T('editor.export.okProject','✅ PDF completo esportato.'));
      // navigator.clipboard?.writeText(result.path).catch(()=>{});
    } else if (result && result.error === 'canceled') {
      showToast(T('editor.export.canceled','Operazione annullata.'));
    } else {
      const msg = result?.error || 'sconosciuto';
      showToast(T('editor.export.err','❌ Errore esportazione: ') + msg);
    }
  } catch (err) {
    showToast(T('editor.export.err','❌ Errore esportazione: ') + (err?.message || 'sconosciuto'));
  } finally {
    __exportBusy = false;
  }
}

async function exportCurrentSectionPDF() {
  if (__exportBusy) return;
  __exportBusy = true;
  try {
    const result = await ipcRenderer.invoke('export-section', projectName, currentSection);
    if (result && result.success) {
      showToast(T('editor.export.okSection','✅ PDF della sezione esportato.'));
      // navigator.clipboard?.writeText(result.path).catch(()=>{});
    } else if (result && result.error === 'canceled') {
      showToast(T('editor.export.canceled','Operazione annullata.'));
    } else {
      const msg = result?.error || 'sconosciuto';
      showToast(T('editor.export.err','❌ Errore esportazione: ') + msg);
    }
  } catch (err) {
    showToast(T('editor.export.err','❌ Errore esportazione: ') + (err?.message || 'sconosciuto'));
  } finally {
    __exportBusy = false;
  }
}


function goBack() { window.location.href = 'index.html'; }

/* Autosave ottimizzato con debounce */
let lastSaveTimeout = null;
let lastSavedHTML = '';

function scheduleAutoSave() {
  if (lastSaveTimeout) clearTimeout(lastSaveTimeout);
  lastSaveTimeout = setTimeout(() => {
    if (!currentSection || isReadOnly) return;

    // raccoglie il contenuto attuale
    const pages = Array.from(editorArea.querySelectorAll('.page-content'));
    const html = pages.map(pc => pc.innerHTML.trim()).join('\n');

    // evita salvataggi identici
    if (html === lastSavedHTML) return;
    lastSavedHTML = html;

    saveSection();
  }, 1000); // attende 1 secondo di inattività
}

// trigger su input e cambio sezione
editorArea.addEventListener('input', scheduleAutoSave);
window.addEventListener('beforeunload', () => { if (lastSaveTimeout) saveSection(); });
// 🔹 Salva automaticamente quando si cambia sezione
document.querySelectorAll('.section-button').forEach(btn => {
  btn.addEventListener('click', () => {
    saveSection();
  });
});


/* =========================
   Icone lock/unlock (toolbar)
   ========================= */
const LOCKED_SVG = `
  <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
    <path d="M7 10V7a5 5 0 1 1 10 0v3" />
    <rect x="5" y="10" width="14" height="10" rx="2" />
  </svg>`;
const UNLOCKED_SVG = `
  <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
    <path d="M17 10V7a5 5 0 0 0-9.9-1" />
    <rect x="5" y="10" width="14" height="10" rx="2" />
  </svg>`;
if (readOnlyBtn) {
  readOnlyBtn.innerHTML = LOCKED_SVG;
  const l = T('editor.readonly','Solo lettura');
  readOnlyBtn.setAttribute('aria-label', l);
  readOnlyBtn.setAttribute('title', l);
}

/* =========================
   TIMELINE
   ========================= */
let timelineData = []; // [{id,title,desc,ordering,colorId?,stackPos?}]
let zoomLevel = 1;

const COLORS = [
  { id:'red',    name: () => T('editor.timeline.colors.red','Rosso (Conflitto)'),        hex:'#ff5252' },
  { id:'blue',   name: () => T('editor.timeline.colors.blue','Blu (Dialogo)'),           hex:'#4dabff' },
  { id:'green',  name: () => T('editor.timeline.colors.green','Verde (Svolta)'),         hex:'#4caf50' },
  { id:'yellow', name: () => T('editor.timeline.colors.yellow','Giallo (Setup)'),        hex:'#ffca28' },
  { id:'purple', name: () => T('editor.timeline.colors.purple','Viola (Climax)'),        hex:'#9c27b0' },
  { id:'white',  name: () => T('editor.timeline.colors.white','Bianco (Transizione)'),   hex:'#e0e0e0' },
  { id:'black',  name: () => T('editor.timeline.colors.black','Nero (Flashback)'),       hex:'#424242' },
  { id:'orange', name: () => T('editor.timeline.colors.orange','Arancione (Tensione)'),  hex:'#ff9800' }
];

function tlNewId(){ return 'ev_' + Math.random().toString(36).slice(2,9); }
function colorHex(id){ const c = COLORS.find(x=>x.id===id); return c ? c.hex : '#aaaaaa'; }

/* Carica/Salva timeline */
async function loadTimeline() {
  try {
    const raw = await ipcRenderer.invoke('load-content', projectName, 'timeline');
    if (!raw || !raw.trim()) { timelineData = []; return; }
    try {
      const parsed = JSON.parse(raw);
      timelineData = Array.isArray(parsed) ? parsed : [];

      // --- MIGRAZIONE ROBUSTA: rimuove qualsiasi variante dei placeholder salvati come testo ---
      let changed = false;

      // Normalizza testo per confronto
      const norm = (s) => (s ?? '')
        .toString()
        .replace(/\u00A0/g, ' ')                 // NBSP -> spazio
        .replace(/[\u200B-\u200D\uFEFF]/g, '')   // zero-width
        .replace(/\.\.\.+/g, '…')                // ... -> …
        .replace(/\s+([….,;:!?])/g, '$1')        // niente spazio prima di punteggiatura/ellissi
        .replace(/\s+/g, ' ')                    // spazi multipli
        .toLowerCase()
        .trim();

      // Genera varianti comuni (… / ...; con/ senza spazio prima; EN/IT)
      const mkSet = (...list) => {
        const variants = new Set();
        list.forEach(s => {
          if (!s) return;
          const base = s.replace(/\.\.\.+/g, '…');
          const v = [
            base,
            base.replace(/…/g, '...'),
            base.replace(/ …/g, '…'),            // rimuovi spazio prima dell’ellissi
            base.replace(/…/g, ' ...'),          // inserisci spazio prima dell’ellissi
          ];
          v.forEach(x => variants.add(norm(x)));
        });
        return variants;
      };

      const titleSet = mkSet(
        T('editor.timeline.titlePh','Titolo evento…'),
        'Titolo evento…','TITOLO EVENTO…','Titolo evento...','TITOLO EVENTO...',
        'Event title…','EVENT TITLE…','Event title...','EVENT TITLE...'
      );

      const descSet = mkSet(
        T('editor.timeline.descPh','Descrizione…'),
        'Descrizione…','DESCRIZIONE…','Descrizione...','DESCRIZIONE...',
        'Description…','DESCRIPTION…','Description...','DESCRIPTION...'
      );

      timelineData.forEach(ev => {
        const nt = norm(ev.title);
        const nd = norm(ev.desc);
        if (titleSet.has(nt)) { ev.title = ''; changed = true; }
        if (descSet.has(nd))  { ev.desc  = ''; changed = true; }
      });

      if (changed) saveTimeline(); // persiste la pulizia, così da ora i placeholder i18n funzionano

      // ---------------------------------------------------------------------

    } catch { timelineData = []; }
  } catch { timelineData = []; }
}

async function saveTimeline() {
  const payload = JSON.stringify(timelineData, null, 2);
  try {
    await ipcRenderer.invoke('save-content', payload, projectName, 'timeline');
  } catch (err) {
    console.error('Errore nel salvataggio timeline:', err);
  }
}


/* Zoom */
function initTimelineUI(){
  if (tlZoomInBtn) tlZoomInBtn.onclick = () => setZoom(zoomLevel + 0.1);
  if (tlZoomOutBtn) tlZoomOutBtn.onclick = () => setZoom(zoomLevel - 0.1);

  // Forza il comportamento della scrollbar verticale
  if (tlViewport) {
    tlViewport.style.overflowY = 'scroll'; // sempre visibile
    tlViewport.style.overflowX = 'auto';   // orizzontale solo se serve

    // Zoom con CTRL+rotella
    tlViewport.addEventListener('wheel', (e) => {
      if (e.target.closest('.ev-desc--edit')) return;
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = Math.sign(e.deltaY);
        const step = 0.05;
        setZoom(zoomLevel + (delta > 0 ? -step : step));
      }
    }, { passive: false });
  }

  setZoom(zoomLevel);
}

/**
 * Mantiene stabile la zona visualizzata verticalmente durante lo zoom.
 * Strategia: calcoliamo il rapporto del centro visibile rispetto all'altezza del track
 * PRIMA dello zoom, poi lo riapplichiamo DOPO lo zoom.
 */
function setZoom(z){
  const vp = tlViewport;
  const track = tlTrack;
  const prevZoom = zoomLevel;

  zoomLevel = Math.max(0.5, Math.min(2, z));

  // Stato PRIMA dello zoom: rapporto del centro visibile rispetto al track
  let ratio = 0.5; // fallback centro
  if (vp && track) {
    const vpCH = vp.clientHeight || 0;
    const beforeTrackRect = track.getBoundingClientRect(); // forziamo layout
    const trackTopInVp = track.offsetTop;                  // top relativo al viewport scrollabile
    const trackH = beforeTrackRect.height || 1;
    const centerAbs = (vp.scrollTop + vpCH / 2) - trackTopInVp; // distanza del centro visibile dal top del track
    ratio = Math.max(0, Math.min(1, centerAbs / trackH));
  }

  // Applica lo zoom (CSS variable usata in #timelineTrack { zoom: var(--tl-zoom) })
  document.documentElement.style.setProperty('--tl-zoom', String(zoomLevel));
  if (tlZoomDisplay) tlZoomDisplay.textContent = Math.round(zoomLevel * 100) + '%';

  // DOPO lo zoom, ricalcola lo scrollTop per mantenere lo stesso "punto relativo"
  if (vp && track) {
    requestAnimationFrame(() => {
      const vpCH2 = vp.clientHeight || 0;
      const afterTrackRect = track.getBoundingClientRect(); // nuovo layout con zoom applicato
      const trackTopInVp2 = track.offsetTop;
      const trackH2 = afterTrackRect.height || 1;

      // centro target: stesso rapporto rispetto all’altezza del track
      const targetCenterAbs = ratio * trackH2;
      const newScrollTop = trackTopInVp2 + targetCenterAbs - (vpCH2 / 2);

      vp.scrollTop = Math.max(0, Math.round(newScrollTop));
    });
  }
}

/* ==== Helpers DnD Timeline ==== */
function getDropRegion(card, e){
  const r = card.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const w = r.width;
  const h = r.height;
  const horiz = x < w*0.25 ? 'left' : (x > w*0.75 ? 'right' : null);
  const vert  = y < h*0.25 ? 'top'  : (y > h*0.75 ? 'bottom' : null);
  return vert || horiz || 'right';
}
function clearDropHints(card){
  card.classList.remove('drop-hint','drop-hint-top','drop-hint-bottom','drop-hint-left','drop-hint-right');
}
function showDropHint(card, e){
  clearDropHints(card);
  card.classList.add('drop-hint');
  const region = getDropRegion(card, e);
  card.classList.add(`drop-hint-${region}`);
}
function normalizeOrderings(){
  const groupsMap = new Map();
  for (const ev of timelineData) {
    const key = ev.ordering ?? 0;
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(ev);
  }
  const groups = Array.from(groupsMap.entries()).sort((a,b)=>a[0]-b[0]).map(([k,arr])=>arr);
  let ord = 10;
  for (const group of groups) {
    for (const ev of group) ev.ordering = ord;
    ord += 10;
  }
}
function restack(ordering){
  const g = timelineData.filter(e => e.ordering === ordering);
  g.sort((a,b)=>(a.stackPos??0)-(b.stackPos??0));
  g.forEach((e,i)=> e.stackPos = i);
}

/* Read-only per timeline */
function applyTimelineReadOnly(){
  if (!tlContainer) return;
  tlContainer.classList.toggle('timeline-readonly', isReadOnly);
  if (!tlTrack) return;
  tlTrack.querySelectorAll('.ev-card').forEach(c => {
    const t = c.querySelector('.ev-title');
    const d = c.querySelector('.ev-desc');
    const h = c.querySelector('.ev-drag');
    if (t) t.contentEditable = String(!isReadOnly);
    if (d) d.contentEditable = String(!isReadOnly);
    if (h) h.draggable = !isReadOnly;
  });
}

/* ==== RENDER Timeline ==== */
let draggingId = null;

function renderTimeline(){
  if (!tlTrack) return;
  tlTrack.innerHTML = '';

  const groupsMap = new Map();
  (timelineData || []).forEach(ev => {
    const key = (ev.ordering ?? 0);
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(ev);
  });

  const groups = Array.from(groupsMap.entries()).sort((a,b)=>a[0]-b[0]);

  groups.forEach(([ord, events]) => {
    const container = document.createElement('div');
    if (events.length > 1) container.className = 'ev-stack';

    events.sort((a,b) => (a.stackPos ?? 0) - (b.stackPos ?? 0));

    events.forEach(ev => {
      const card = document.createElement('div');
      card.className = 'ev-card';
      card.dataset.id = ev.id;

      const bar = document.createElement('div');
      bar.className = 'ev-color-bar';
      bar.style.background = ev.colorId ? colorHex(ev.colorId) : 'transparent';

      const square = document.createElement('button');
      square.type = 'button';
      square.className = 'ev-color-btn';
      square.style.background = ev.colorId ? colorHex(ev.colorId) : '#aaa';
      square.setAttribute('aria-label', T('editor.timeline.pickColor','Scegli colore')); // i18n

      const select = document.createElement('select');
      select.className = 'ev-color-menu';
      select.hidden = true;
      const optNone = document.createElement('option');
      optNone.value = '';
      optNone.textContent = T('editor.timeline.noColor','Senza colore'); // i18n
      select.appendChild(optNone);
      COLORS.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name(); // i18n
        select.appendChild(o);
      });
      select.value = ev.colorId || '';

      square.addEventListener('click', (e) => {
        if (isReadOnly) return;
        e.stopPropagation();
        select.hidden = !select.hidden;
        if (!select.hidden) select.focus();
      });
      select.addEventListener('change', () => {
        if (isReadOnly) return;
        ev.colorId = select.value || '';
        const hex = ev.colorId ? colorHex(ev.colorId) : 'transparent';
        bar.style.background = hex;
        square.style.background = ev.colorId ? hex : '#aaa';
        saveTimeline();
        select.hidden = true;
      });
      select.addEventListener('blur', () => { select.hidden = true; });

      const del = document.createElement('button');
      del.className = 'ev-close';
      del.textContent = '✕';
      del.title = T('common.delete','Elimina'); // i18n: tooltip/elenco
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isReadOnly) return;

        // snapshot dell'evento e della sua posizione
        const snapshot = { ...ev };

        // rimuovi
        timelineData = timelineData.filter(x => x.id !== ev.id);
        saveTimeline();
        renderTimeline();

        // focus di cortesia
        const firstTitle = tlTrack.querySelector('.ev-card .ev-title');
        if (firstTitle) firstTitle.focus();

        // toast undo localizzato
        showUndoToast?.(
          T('editor.timeline.eventRemoved','Evento timeline eliminato.'),
          () => {
            timelineData.push(snapshot);
            restack(snapshot.ordering ?? 0);
            saveTimeline();
            renderTimeline();
          },
          { undoLabel: T('common.undo','Annulla') }
        );
      });

// --- TITLE ---
const title = document.createElement('div');
title.className = 'ev-title';
title.contentEditable = String(!isReadOnly);
title.textContent = ev.title || '';
// placeholder sempre presente (testo localizzato)
title.setAttribute('data-placeholder', T('editor.timeline.titlePh','Event title…'));
// stato iniziale "vuoto" per il placeholder
if (!ev.title || !ev.title.trim()) title.classList.add('is-empty');

let title_prev = title.textContent;

title.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

title.addEventListener('input', () => {
  // Uppercase + limite 2 righe (come prima)
  const before = title.textContent;
  title.textContent = before.toUpperCase();
  placeCaretAtEnd(title);

  const lh = parseFloat(getComputedStyle(title).lineHeight) || 20;
  const maxH = lh * 2 + 1;
  if (title.scrollHeight > maxH) {
    title.textContent = title_prev;
    placeCaretAtEnd(title);
  } else {
    title_prev = title.textContent;
  }

  // toggle placeholder
  const txt = title.textContent.trim();
  title.classList.toggle('is-empty', txt.length === 0);

  // salva
  const item = timelineData.find(x => x.id === ev.id);
  if (item) { item.title = txt; saveTimeline(); }
});

title.addEventListener('blur', () => {
  const txt = (title.textContent || '').trim().toUpperCase();
  title.textContent = txt;
  title.classList.toggle('is-empty', txt.length === 0);
  const item = timelineData.find(x => x.id === ev.id);
  if (item) { item.title = txt; saveTimeline(); }
});

// --- DESC ---
const desc = document.createElement('div');
desc.className = 'ev-desc';
desc.contentEditable = String(!isReadOnly);
desc.textContent = ev.desc || '';
// placeholder sempre presente (testo localizzato)
desc.setAttribute('data-placeholder', T('editor.timeline.descPh','Description…'));
// stato iniziale "vuoto"
if (!ev.desc || !ev.desc.trim()) desc.classList.add('is-empty');

desc.addEventListener('focus', () => { desc.classList.add('ev-desc--edit'); });

desc.addEventListener('blur', () => {
  desc.classList.remove('ev-desc--edit');
  const txt = (desc.textContent || '').trim();
  desc.classList.toggle('is-empty', txt.length === 0);
  const item = timelineData.find(x => x.id === ev.id);
  if (item) { item.desc = txt; saveTimeline(); }
});

desc.addEventListener('input', () => {
  const txt = (desc.textContent || '').trim();
  desc.classList.toggle('is-empty', txt.length === 0);
  const item = timelineData.find(x => x.id === ev.id);
  if (item) { item.desc = txt; saveTimeline(); }
});


      const dragBtn = document.createElement('button');
      dragBtn.className = 'ev-drag';
      dragBtn.type = 'button';
      dragBtn.setAttribute('aria-label', T('editor.timeline.drag','Trascina')); // i18n
      dragBtn.draggable = !isReadOnly;

      dragBtn.addEventListener('dragstart', (e) => {
        if (isReadOnly) { e.preventDefault(); return; }
        draggingId = ev.id;
        card.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', ev.id); } catch(_) {}
        e.dataTransfer.effectAllowed = 'move';
        if (e.dataTransfer.setDragImage) {
          e.dataTransfer.setDragImage(card, card.offsetWidth/2, card.offsetHeight/2);
        }
      });
      dragBtn.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        clearDropHints(card);
        draggingId = null;
      });

      card.addEventListener('dragenter', (e) => {
        if (!draggingId || draggingId === ev.id) return;
        showDropHint(card, e);
      });
      let rafToken = null;
      card.addEventListener('dragover', (e) => {
        if (!draggingId || draggingId === ev.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (rafToken) return;
        rafToken = requestAnimationFrame(() => {
          showDropHint(card, e);
          rafToken = null;
        });
      });

      card.addEventListener('dragleave', () => { clearDropHints(card); });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggingId || draggingId === ev.id || isReadOnly) return;

        clearDropHints(card);

        const src = timelineData.find(x => x.id === draggingId);
        const target = ev;
        if (!src || !target) return;

        const region = getDropRegion(card, e);

        if (region === 'left') {
          src.ordering = (target.ordering ?? 0) - 1;
          src.stackPos = 0;
          normalizeOrderings();
        } else if (region === 'right') {
          src.ordering = (target.ordering ?? 0) + 1;
          src.stackPos = 0;
          normalizeOrderings();
        } else if (region === 'top' || region === 'bottom') {
          const tgtOrder = (target.ordering ?? 0);

          const wasOrder = src.ordering;
          src.ordering = tgtOrder;
          let newPos = (target.stackPos ?? 0) + (region === 'bottom' ? 1 : 0);

          timelineData
            .filter(e2 => e2.ordering === tgtOrder && e2.id !== src.id)
            .sort((a,b)=>(a.stackPos??0)-(b.stackPos??0))
            .forEach(e2 => { if ((e2.stackPos ?? 0) >= newPos) e2.stackPos = (e2.stackPos ?? 0) + 1; });

          src.stackPos = newPos;
          restack(tgtOrder);
          if (wasOrder !== tgtOrder) restack(wasOrder);
        }

        saveTimeline();
        renderTimeline();
      });

      card.appendChild(bar);
      card.appendChild(square);
      card.appendChild(select);
      card.appendChild(del);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(dragBtn);
      container.appendChild(card);
    });

    tlTrack.appendChild(container);
  });

  applyTimelineReadOnly();

  if (timelineData.length === 0 && tlViewport) {
    tlViewport.tabIndex = 0;
    tlViewport.focus();
  }
}


/* + Evento */
if (tlAddEventBtn) {
  tlAddEventBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    const maxOrd = timelineData.reduce((m,e)=>Math.max(m, e.ordering||0), 0);
    const ev = { id: tlNewId(), title: '', desc: '', ordering: maxOrd + 10, colorId: '', stackPos: 0 };
    timelineData.push(ev);
    saveTimeline();
    renderTimeline();
    const titleEl = tlTrack.querySelector(`.ev-card[data-id="${ev.id}"] .ev-title`);
    if (titleEl) {
      titleEl.focus();
      // centra in viewport sia orizzontale che verticale
      titleEl.closest('.ev-card')?.scrollIntoView({ behavior:'smooth', block:'center', inline:'center' });
    }
  });
}

// Auto-scroll verticale in drag vicino agli edge del viewport
(function initTimelineAutoScroll(){
  if (!tlViewport) return;
  let raf = null;
  let curDy = 0;

  tlViewport.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    const rect = tlViewport.getBoundingClientRect();
    const margin = 72; // ⬆︎ soglia più ampia
    const speed  = 26; // ⬆︎ scorrimento più rapido

    let dy = 0;
    if (e.clientY < rect.top + margin)       dy = -speed;
    else if (e.clientY > rect.bottom - margin) dy =  speed;

    // Se fuori dalle zone edge → ferma subito
    if (!dy) { if (raf){ cancelAnimationFrame(raf); raf=null; } curDy = 0; return; }
    curDy = dy;

    if (!raf) {
      const step = () => {
        if (!curDy) { raf = null; return; }
        tlViewport.scrollTop += curDy;
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
  });

  // Stop auto-scroll quando finisce il drag o si esce
  ['dragleave','drop','dragend'].forEach(evName => {
    tlViewport.addEventListener(evName, () => {
      curDy = 0;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    });
  });
})();

/* ===== PATCH: helper campi personalizzati (comuni) ===== */
function newCustomField() {
  return {
    id: 'cf_' + Math.random().toString(36).slice(2,9),
    title: '',           // <-- vuoto: lascia lavorare il placeholder
    value: '',
    collapsed: false
  };
}

/* Sposta elemento in array da fromIdx a toIdx (in place) */
function arrayMove(arr, fromIdx, toIdx){
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= arr.length || toIdx >= arr.length) return;
  const [item] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, item);
}

/* Abilita DnD locale tra righe personalizzate dentro un contenitore card */
function enableLocalCustomFieldReorder(containerEl, rowSelector, arrRef, onCommit){
  let draggingRow = null;
  let draggingIdx = -1;

  const refreshDraggables = () => {
    const rows = Array.from(containerEl.querySelectorAll(rowSelector));
    rows.forEach((row, idx) => {
      const handle = row.querySelector('.drag-handle');
      if (!handle) return;
      handle.draggable = !isReadOnly;
      handle.addEventListener('dragstart', (e) => {
        if (isReadOnly) { e.preventDefault(); return; }
        draggingRow = row;
        draggingIdx = idx;
        row.classList.add('field-dragging');
        try { e.dataTransfer.setData('text/plain', 'cf'); } catch(_) {}
        e.dataTransfer.effectAllowed = 'move';
      });
      handle.addEventListener('dragend', () => {
        if (draggingRow) draggingRow.classList.remove('field-dragging');
        draggingRow = null; draggingIdx = -1;
        rows.forEach(r => r.classList.remove('field-drop-hint'));
      });
    });
  };

  refreshDraggables();

  containerEl.addEventListener('dragover', (e) => {
    if (!draggingRow) return;
    const targetRow = e.target.closest(rowSelector);
    if (!targetRow || targetRow === draggingRow) return;
    e.preventDefault();
    containerEl.querySelectorAll(rowSelector).forEach(r => r.classList.remove('field-drop-hint'));
    targetRow.classList.add('field-drop-hint');
  });

  containerEl.addEventListener('drop', (e) => {
    if (!draggingRow) return;
    const targetRow = e.target.closest(rowSelector);
    if (!targetRow || targetRow === draggingRow) return;
    e.preventDefault();
    const rows = Array.from(containerEl.querySelectorAll(rowSelector));
    const targetIdx = rows.indexOf(targetRow);
    if (draggingIdx >= 0 && targetIdx >= 0) {
      arrayMove(arrRef, draggingIdx, targetIdx);
      onCommit && onCommit();
    }
  });
}


/* =========================
   PERSONAGGI — UI a CARD
   ========================= */
let charsData = [];
let charUI = null;
let charList = null;
let charSearchInput = null;
let charAddBtn = null;

function newCharacter() {
  return {
    id: 'ch_' + Math.random().toString(36).slice(2,9),
    name: '',
    role: '',
    ageAppearance: '',
    background: '',
    goal: '',
    conflict: '',
    arc: '',
    relationships: '',
    traits: '',
    quote: '',
    notes: '',
    collapsed: false,
/* PATCH: sezioni personalizzate locali alla card */
customFields: [] // [{id,title,value,collapsed}]
  };
}

async function loadCharacters() {
  try {
    const raw = await ipcRenderer.invoke('load-content', projectName, 'personaggi');
    if (!raw || !raw.trim()) { charsData = []; return; }
    try {
      const parsed = JSON.parse(raw);
      charsData = Array.isArray(parsed) ? parsed : [];

      // PATCH: normalizza i titoli delle sezioni personalizzate
      (charsData || []).forEach(ch => {
        (ch.customFields || []).forEach(cf => {
          if ((cf.title || '').trim().toLowerCase() === 'sezione personalizzata') {
            cf.title = ''; // lascia vuoto → usa placeholder
          }
        });
      });

    } catch { charsData = []; }
  } catch { charsData = []; }
}

async function saveCharacters() {
  try {
    const payload = JSON.stringify(charsData, null, 2);
    await ipcRenderer.invoke('save-content', payload, projectName, 'personaggi');
    console.log(`[${projectName}] Personaggi salvati correttamente.`);
  } catch (e) {
    console.error('saveCharacters error:', e);
  }
}


/* --- Snackbar / Toast UNDO (stackable) --- */
let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  const c = document.createElement('div');
  c.id = 'toastContainer';
  Object.assign(c.style, {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: '3000',
    pointerEvents: 'none'
  });
  document.body.appendChild(c);
  toastContainer = c;
  return c;
}

// Toast semplice (solo messaggio)
function showToast(message, { duration = 4000 } = {}) {
  const container = ensureToastContainer();

  const t = document.createElement('div');
  Object.assign(t.style, {
    background: 'rgba(30,30,30,0.95)',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '10px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    fontSize: '14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    pointerEvents: 'auto'
  });
  t.textContent = message;
  container.appendChild(t);

  setTimeout(() => {
    if (t.parentNode) t.parentNode.removeChild(t);
    if (!container.children.length) { container.remove(); toastContainer = null; }
  }, duration);
}

/* --- Snackbar / Toast UNDO (stackable) --- */

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  const c = document.createElement('div');
  c.id = 'toastContainer';
  Object.assign(c.style, {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: '3000',
    pointerEvents: 'none'
  });
  document.body.appendChild(c);
  toastContainer = c;
  return c;
}

// Toast semplice (solo messaggio)
function showToast(message, { duration = 4000 } = {}) {
  const container = ensureToastContainer();

  const t = document.createElement('div');
  Object.assign(t.style, {
    background: 'rgba(30,30,30,0.95)',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '10px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    fontSize: '14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    pointerEvents: 'auto'
  });
  t.textContent = message;
  container.appendChild(t);

  setTimeout(() => {
    if (t.parentNode) t.parentNode.removeChild(t);
    if (!container.children.length) { container.remove(); toastContainer = null; }
  }, duration);
}

// Toast con UNDO (richiamato da timeline/personaggi/scaletta)
function showUndoToast(message, onUndo, { duration = 6000, undoLabel = 'Annulla' } = {}) {
  const container = ensureToastContainer();
  const t = document.createElement('div');
  Object.assign(t.style, {
    background: 'rgba(30,30,30,0.95)',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '10px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    fontSize: '14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    pointerEvents: 'auto'
  });

  const msg = document.createElement('span');
  msg.textContent = message;

  const undo = document.createElement('button');
  undo.textContent = undoLabel;
  Object.assign(undo.style, {
    background: 'transparent',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.6)',
    borderRadius: '6px',
    padding: '4px 8px',
    cursor: 'pointer'
  });

  let timer = setTimeout(cleanup, duration);

  function cleanup() {
    if (t.parentNode) t.parentNode.removeChild(t);
    if (!container.children.length) { container.remove(); toastContainer = null; }
  }

  undo.addEventListener('click', () => {
    clearTimeout(timer);
    try { onUndo && onUndo(); } finally { cleanup(); }
  });

  t.appendChild(msg);
  t.appendChild(undo);
  container.appendChild(t);
}

// “Confirm toast” non bloccante (OK / Annulla) → Promise<boolean>
function showConfirmToast(message, { okLabel = 'OK', cancelLabel = 'Annulla', timeout = 15000 } = {}) {
  const container = ensureToastContainer();

  return new Promise((resolve) => {
    const t = document.createElement('div');
    Object.assign(t.style, {
      background: 'rgba(30,30,30,0.95)',
      color: '#fff',
      padding: '10px 14px',
      borderRadius: '10px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      fontSize: '14px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      pointerEvents: 'auto'
    });

    const msg = document.createElement('span');
    msg.textContent = message;

    const ok = document.createElement('button');
    ok.textContent = okLabel;
    Object.assign(ok.style, {
      background: 'transparent',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.6)',
      borderRadius: '6px',
      padding: '4px 8px',
      cursor: 'pointer'
    });

    const cancel = document.createElement('button');
    cancel.textContent = cancelLabel;
    Object.assign(cancel.style, {
      background: 'transparent',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.3)',
      borderRadius: '6px',
      padding: '4px 8px',
      cursor: 'pointer',
      opacity: .8
    });

    const cleanup = (val) => {
      if (t.parentNode) t.parentNode.removeChild(t);
      if (!container.children.length) { container.remove(); toastContainer = null; }
      resolve(val);
    };

    ok.addEventListener('click', () => cleanup(true));
    cancel.addEventListener('click', () => cleanup(false));

    // auto-dismiss dopo timeout → annulla
    const timer = setTimeout(() => cleanup(false), timeout);
    [ok, cancel].forEach(b => b.addEventListener('click', () => clearTimeout(timer)));

    t.appendChild(msg);
    t.appendChild(ok);
    t.appendChild(cancel);
    container.appendChild(t);
  });
}

/* --- UI Personaggi --- */
function buildCharactersUI() {
  if (charUI) {
    charUI.style.display = 'flex';
    editorArea.appendChild(charUI);
    return;
  }

  charUI = document.createElement('div');
  charUI.className = 'char-wrap';

  const bar = document.createElement('div');
  bar.className = 'char-toolbar';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'char-search-wrap';

  charSearchInput = document.createElement('input');
  charSearchInput.type = 'search';
  charSearchInput.placeholder = T('editor.chars.searchPh','Cerca personaggio…');
  charSearchInput.className = 'char-search';
  charSearchInput.addEventListener('input', () => {
    renderCharacters();
    clearBtn.style.display = (charSearchInput.value || '').length ? 'inline-flex' : 'none';
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'char-search-clear';
  clearBtn.type = 'button';
  clearBtn.setAttribute('aria-label', T('common.clear','Pulisci ricerca'));
  clearBtn.textContent = '✕';
  clearBtn.style.display = 'none';
  clearBtn.addEventListener('click', () => {
    charSearchInput.value = '';
    renderCharacters();
    clearBtn.style.display = 'none';
    charSearchInput.focus();
  });

  searchWrap.appendChild(charSearchInput);
  searchWrap.appendChild(clearBtn);

  charAddBtn = document.createElement('button');
  charAddBtn.type = 'button';
  charAddBtn.className = 'char-add-btn';
  charAddBtn.textContent = T('editor.chars.add','+ Aggiungi personaggio');
  charAddBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    const ch = newCharacter();
    charsData.push(ch);
    saveCharacters();
    renderCharacters();
    applyReadOnlyStateCharacters();
    const el = charList.querySelector(`[data-id="${ch.id}"] .ch-name`);
    if (el) el.focus();
  });

  bar.appendChild(searchWrap);
  bar.appendChild(charAddBtn);

  charList = document.createElement('div');
  charList.className = 'char-list';

  editorArea.appendChild(charUI);
  charUI.appendChild(bar);
  charUI.appendChild(charList);
}

function destroyCharactersUI() {
  if (!charUI) return;
  if (charUI.parentElement === editorArea) editorArea.removeChild(charUI);
  charUI.style.display = 'none';
}


function renderCharacters() {
  if (!charList) return;
  const q = (charSearchInput?.value || '').trim().toLowerCase();
  charList.innerHTML = '';

  const items = (q ? charsData.filter(c => (c.name||'').toLowerCase().includes(q)) : charsData);

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'char-empty';
    empty.textContent = T('editor.chars.empty','Nessun personaggio. Premi “+ Aggiungi personaggio”.');
    charList.appendChild(empty);
    return;
  }

  items.forEach(ch => {
    charList.appendChild(createCharCard(ch));
  });

  applyReadOnlyStateCharacters();
}


function createField(labelText, className, value, multiline=false, onChange=null, placeholder='') {
  const row = document.createElement('div');
  row.className = 'ch-field';

  const label = document.createElement('div');
  label.className = 'ch-label';
  label.textContent = labelText;

  let input;
  if (multiline) {
    input = document.createElement('div');
    input.className = 'ch-input ch-multiline ' + className;
    input.contentEditable = String(!isReadOnly);
    input.innerText = value || '';
  } else {
    input = document.createElement('div');
    input.className = 'ch-input ch-line ' + className;
    input.contentEditable = String(!isReadOnly);
    input.innerText = value || '';
  }

  if (placeholder) input.setAttribute('data-placeholder', placeholder);

  if (onChange) {
    const handler = () => onChange(input.innerText);
    input.addEventListener('input', handler);
    input.addEventListener('blur', handler);
  }

  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function createCharCard(ch) {
  const card = document.createElement('div');
  card.className = 'ch-card';
  card.dataset.id = ch.id;

  const header = document.createElement('div');
  header.className = 'ch-header';

  const nameInput = document.createElement('div');
  nameInput.className = 'ch-name';
  nameInput.contentEditable = String(!isReadOnly);
  nameInput.setAttribute('data-placeholder', T('editor.chars.namePh','Nome del personaggio'));
  nameInput.innerText = ch.name || '';
  nameInput.addEventListener('input', () => { ch.name = nameInput.innerText; debouncedSaveCharacters(); });


  const actions = document.createElement('div');
  actions.className = 'ch-actions';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'ch-action ch-toggle';
  toggleBtn.title = ch.collapsed ? T('common.expand','Espandi') : T('common.collapse','Compatta');
  toggleBtn.textContent = ch.collapsed ? '▾' : '▴';
  toggleBtn.addEventListener('click', () => {
    ch.collapsed = !ch.collapsed;
    saveCharacters();
    renderCharacters();
  });

  const upBtn = document.createElement('button');
  upBtn.className = 'ch-action';
  upBtn.title = T('common.moveUp','Sposta su');
  upBtn.textContent = '↑';
  upBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    const idx = charsData.findIndex(x => x.id === ch.id);
    if (idx > 0) {
      const tmp = charsData[idx - 1]; charsData[idx - 1] = charsData[idx]; charsData[idx] = tmp;
      saveCharacters(); renderCharacters();
      focusName(ch.id);
    }
  });

  const downBtn = document.createElement('button');
  downBtn.className = 'ch-action';
  downBtn.title = T('common.moveDown','Sposta giù');
  downBtn.textContent = '↓';
  downBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    const idx = charsData.findIndex(x => x.id === ch.id);
    if (idx >= 0 && idx < charsData.length - 1) {
      const tmp = charsData[idx + 1]; charsData[idx + 1] = charsData[idx]; charsData[idx] = tmp;
      saveCharacters(); renderCharacters();
      focusName(ch.id);
    }
  });

  const addSectionBtn = document.createElement('button');
  addSectionBtn.className = 'ch-action inline-add-btn';
  addSectionBtn.title = T('editor.custom.add','Aggiungi sezione personalizzata');
  addSectionBtn.textContent = T('editor.custom.addShort','+ Sezione');
  addSectionBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    if (!Array.isArray(ch.customFields)) ch.customFields = [];
    ch.customFields.push(newCustomField());
    saveCharacters();
    renderCharacters();
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'ch-close ev-close';
  delBtn.title = T('common.delete','Elimina');
  delBtn.textContent = '✕';
  delBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
  delBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReadOnly) return;

    const idx = charsData.findIndex(x => x.id === ch.id);
    if (idx === -1) return;

    const snapshot = { ...ch };

    charsData.splice(idx, 1);
    saveCharacters();
    renderCharacters();
    applyReadOnlyStateCharacters();

    const nextIdx = Math.min(idx, charsData.length - 1);
    if (nextIdx >= 0) focusName(charsData[nextIdx].id);

    showUndoToast(T('editor.chars.removed','Personaggio eliminato.'), () => {
      const insertAt = Math.max(0, Math.min(idx, charsData.length));
      charsData.splice(insertAt, 0, snapshot);
      saveCharacters();
      renderCharacters();
      applyReadOnlyStateCharacters();
      focusName(snapshot.id);
    }, { undoLabel: T('common.undo','Annulla') });
  });

  actions.appendChild(toggleBtn);
  actions.appendChild(upBtn);
  actions.appendChild(downBtn);
  actions.appendChild(addSectionBtn);
  header.appendChild(nameInput);
  header.appendChild(actions);
  header.appendChild(delBtn);

  const body = document.createElement('div');
  body.className = 'ch-body';
  if (ch.collapsed) body.style.display = 'none';

  const pushField = (label, cls, key, multiline = false, placeholder = '') => {
    const f = createField(label, cls, ch[key], multiline, (val) => { ch[key] = val; debouncedSaveCharacters(); }, placeholder);
    body.appendChild(f);
  };

  pushField(T('editor.chars.role','Ruolo'), 'ch-role', 'role', false, T('editor.chars.rolePh','protagonista, antagonista, comprimario…'));
  pushField(T('editor.chars.age','Età / Aspetto'), 'ch-age', 'ageAppearance', false, T('editor.chars.agePh','età apparente, segni, look…'));
  pushField(T('editor.chars.background','Background'), 'ch-bg', 'background', true, T('editor.chars.backgroundPh','storia pregressa, origini, contesto…'));
  pushField(T('editor.chars.goal','Obiettivo'), 'ch-goal', 'goal', true, T('editor.chars.goalPh','cosa vuole adesso / a lungo termine…'));
  pushField(T('editor.chars.conflict','Conflitto'), 'ch-conflict', 'conflict', true, T('editor.chars.conflictPh','cosa lo ostacola, interno/esterno…'));
  pushField(T('editor.chars.arc','Arco narrativo'), 'ch-arc', 'arc', true, T('editor.chars.arcPh','come cambia lungo la storia…'));
  pushField(T('editor.chars.relations','Relazioni'), 'ch-rel', 'relationships', true, T('editor.chars.relationsPh','legami chiave, alleati/nemici…'));
  pushField(T('editor.chars.traits','Tratti caratteriali'), 'ch-traits', 'traits', true, T('editor.chars.traitsPh','elenco breve: ironico, cinico…'));
  pushField(T('editor.chars.quote','Citazione'), 'ch-quote', 'quote', false, T('editor.chars.quotePh','frase/battuta che lo rappresenta'));
  pushField(T('editor.chars.notes','Note'), 'ch-notes', 'notes', true, T('editor.chars.notesPh','appunti, idee, dettagli sparsi…'));

  // Sezioni personalizzate locali
  const cfList = Array.isArray(ch.customFields) ? ch.customFields : [];
  cfList.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'ch-field ch-custom-row';

    const lab = document.createElement('div');
    lab.className = 'ch-label';
    lab.setAttribute('data-placeholder', T('editor.custom.section','Sezione personalizzata'));

    const labText = document.createElement('span');
    labText.className = 'label-text';
    labText.contentEditable = String(!isReadOnly);
    labText.setAttribute('data-placeholder', T('editor.custom.section','Sezione personalizzata'));
    labText.textContent = f.title || '';
    if (!f.title) labText.textContent = '';

    labText.addEventListener('input', () => {
      f.title = labText.textContent.trim();
      saveCharacters();
    });

    const charCtrls = document.createElement('div');
    charCtrls.className = 'field-ctrls';

    const charDelSecBtn = document.createElement('button');
    charDelSecBtn.type = 'button';
    charDelSecBtn.title = T('common.deleteSection','Elimina sezione');
    charDelSecBtn.textContent = '✕';
    charDelSecBtn.addEventListener('click', () => {
      if (isReadOnly) return;
      const i = ch.customFields.findIndex(x => x.id === f.id);
      if (i !== -1) {
        const snapshot = { ...f };
        ch.customFields.splice(i, 1);
        saveCharacters();
        renderCharacters();
        showUndoToast(T('editor.custom.removed','Sezione rimossa.'), () => {
          ch.customFields.splice(Math.min(i, ch.customFields.length), 0, snapshot);
          saveCharacters();
          renderCharacters();
        }, { undoLabel: T('common.undo','Annulla') });
      }
    });

    charCtrls.appendChild(charDelSecBtn);

    lab.appendChild(labText);
    lab.appendChild(charCtrls);

    const inp = document.createElement('div');
    inp.className = 'ch-input ch-multiline';
    inp.contentEditable = String(!isReadOnly);
    inp.setAttribute('data-placeholder', T('editor.custom.textPh','Testo…'));
    inp.innerText = f.value || '';
    const onChange = () => { f.value = inp.innerText; debouncedSaveCharacters(); };
    inp.addEventListener('input', onChange);
    inp.addEventListener('blur', onChange);

    row.appendChild(lab);
    row.appendChild(inp);
    body.appendChild(row);
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}


function focusName(id){
  const el = charList.querySelector(`[data-id="${id}"] .ch-name`);
  if (el) {
    requestAnimationFrame(() => {
      el.focus();
      const r = document.createRange(); const s = window.getSelection();
      r.selectNodeContents(el); r.collapse(false);
      s.removeAllRanges(); s.addRange(r);
    });
  }
}

function applyReadOnlyStateCharacters() {
  if (!charUI) return;
  charUI.classList.toggle('char-readonly', isReadOnly);

  charUI.querySelectorAll('.ch-input, .ch-name').forEach(el => {
    el.setAttribute('contenteditable', String(!isReadOnly));
  });

  charUI.querySelectorAll('.ch-action, .ch-close, .char-add-btn').forEach(btn => {
    btn.disabled = isReadOnly;
  });
}

/* =========================
   SCALETTA — Beat a CARD (PATCH con sezioni personalizzate locali)
   ========================= */
let beatsData = [];
let beatUI = null;
let beatList = null;
let beatSearchInput = null;
let beatAddBtn = null;
let beatGroupSelect = null;

function outlineContainerLabel() {
  if (projectType === 'libro')  return T('editor.outline.container.chapter',  'Capitolo');
  if (projectType === 'teatro') return T('editor.outline.container.quadro',   'Quadro');
  return T('editor.outline.container.sequence', 'Sequenza');
}


function newBeat() {
  const maxOrd = beatsData.reduce((m,b)=>Math.max(m, b.ordering||0), 0);
  return {
    id: 'bt_' + Math.random().toString(36).slice(2,9),
    title: '',
    summary: '',
    objective: '',
    obstacle: '',
    outcome: '',
    timePlace: '',
    characters: '',
    links: '',
    container: '',
    collapsed: false,
    ordering: maxOrd + 10,
   /* PATCH: sezioni personalizzate locali alla card */
customFields: [] // [{id,title,value,collapsed}]
  };
}

async function loadOutline() {
  try {
    const raw = await ipcRenderer.invoke('load-content', projectName, 'scaletta');
    if (!raw || !raw.trim()) { beatsData = []; return; }
    try {
      const parsed = JSON.parse(raw);
      beatsData = Array.isArray(parsed) ? parsed : [];

      // PATCH: normalizza i titoli delle sezioni personalizzate
      (beatsData || []).forEach(bt => {
        (bt.customFields || []).forEach(cf => {
          if ((cf.title || '').trim().toLowerCase() === 'sezione personalizzata') {
            cf.title = ''; // svuota → usa placeholder
          }
        });
      });

    } catch { beatsData = []; }
  } catch { beatsData = []; }
}

async function saveOutline() {
  try {
    const payload = JSON.stringify(beatsData, null, 2);
    await ipcRenderer.invoke('save-content', payload, projectName, 'scaletta');
    console.log(`[${projectName}] Scaletta salvata correttamente.`);
  } catch (e) {
    console.error('saveOutline error:', e);
  }
}



function buildOutlineUI() {
  if (beatUI) {
    beatUI.style.display = 'flex';
    editorArea.appendChild(beatUI);
    return;
  }

  beatUI = document.createElement('div');
  beatUI.className = 'beat-wrap';

  const bar = document.createElement('div');
  bar.className = 'beat-toolbar';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'beat-search-wrap';

  beatSearchInput = document.createElement('input');
  beatSearchInput.type = 'search';
  beatSearchInput.placeholder = T('editor.outline.searchPh','Cerca beat…');
  beatSearchInput.className = 'beat-search';
  beatSearchInput.addEventListener('input', () => {
    renderBeats();
    clearBtn.style.display = (beatSearchInput.value || '').length ? 'inline-flex' : 'none';
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'beat-search-clear';
  clearBtn.type = 'button';
  clearBtn.setAttribute('aria-label', T('common.clear','Pulisci ricerca'));
  clearBtn.textContent = '✕';
  clearBtn.style.display = 'none';
  clearBtn.addEventListener('click', () => {
    beatSearchInput.value = '';
    renderBeats();
    clearBtn.style.display = 'none';
    beatSearchInput.focus();
  });

  searchWrap.appendChild(beatSearchInput);
  searchWrap.appendChild(clearBtn);

  const groupWrap = document.createElement('div');
  groupWrap.className = 'beat-group-wrap';
  const groupLbl = document.createElement('label');
  groupLbl.className = 'beat-group-label';
  groupLbl.textContent = T('editor.outline.groupBy','Raggruppa per:');
  beatGroupSelect = document.createElement('select');
  beatGroupSelect.className = 'beat-group-select';
  [
    {v:'nessuno',     l: T('editor.outline.group.none','Nessuno')},
    {v:'contenitore', l: T('editor.outline.group.container','Contenitore')}
  ].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.v;
    o.textContent = opt.l;
    beatGroupSelect.appendChild(o);
  });
  beatGroupSelect.addEventListener('change', renderBeats);
  groupWrap.appendChild(groupLbl);
  groupWrap.appendChild(beatGroupSelect);

  beatAddBtn = document.createElement('button');
  beatAddBtn.type = 'button';
  beatAddBtn.className = 'beat-add-btn';
  beatAddBtn.textContent = T('editor.outline.add','+ Nuovo beat');
  beatAddBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    const bt = newBeat();
    beatsData.push(bt);
    saveOutline();
    renderBeats();
    applyReadOnlyStateOutline();
    const el = beatList.querySelector(`[data-id="${bt.id}"] .bt-title`);
    if (el) el.focus();
  });

  bar.appendChild(searchWrap);
  bar.appendChild(groupWrap);
  bar.appendChild(beatAddBtn);

  beatList = document.createElement('div');
  beatList.className = 'beat-list';

  editorArea.appendChild(beatUI);
  beatUI.appendChild(bar);
  beatUI.appendChild(beatList);
}

function destroyOutlineUI() {
  if (!beatUI) return;
  if (beatUI.parentElement === editorArea) editorArea.removeChild(beatUI);
  beatUI.style.display = 'none';
}

function renderBeats(){
  if (!beatList) return;
  const q = (beatSearchInput?.value || '').trim().toLowerCase();
  beatList.innerHTML = '';

  const sorted = [...beatsData].sort((a,b)=>(a.ordering??0)-(b.ordering??0));
  const filtered = q
    ? sorted.filter(b =>
        (b.title||'').toLowerCase().includes(q) ||
        (b.summary||'').toLowerCase().includes(q))
    : sorted;

  const groupMode = (beatGroupSelect?.value || 'nessuno');
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'beat-empty';
    empty.textContent = T('editor.outline.empty','Nessun beat. Premi “+ Nuovo beat”.');
    beatList.appendChild(empty);
    return;
  }

  const renderWithIndex = (arr) => {
    arr.forEach((b, i) => {
      beatList.appendChild(createBeatCard(b, i + 1));
    });
  };

  if (groupMode === 'contenitore') {
    const byCont = new Map();
    filtered.forEach(b => {
      const key = (b.container || '').trim() || `(${outlineContainerLabel()} ${T('editor.outline.withoutName','senza nome')})`;
      if (!byCont.has(key)) byCont.set(key, []);
      byCont.get(key).push(b);
    });
    Array.from(byCont.entries()).forEach(([groupName, arr]) => {
      const h = document.createElement('div');
      h.className = 'beat-group-title';
      h.textContent = groupName;
      beatList.appendChild(h);
      renderWithIndex(arr);
    });
  } else {
    renderWithIndex(filtered);
  }

  applyReadOnlyStateOutline();
}


function createBeatCard(bt, displayIndex){
  const card = document.createElement('div');
  card.className = 'bt-card';
  card.dataset.id = bt.id;

  const header = document.createElement('div');
  header.className = 'bt-header';

  const idxEl = document.createElement('div');
  idxEl.className = 'bt-index';
  idxEl.textContent = String(displayIndex || 1);

  const titleEl = document.createElement('div');
  titleEl.className = 'bt-title';
  titleEl.contentEditable = String(!isReadOnly);
  titleEl.setAttribute('data-placeholder', T('editor.outline.titlePh','Titolo beat'));
  titleEl.innerText = bt.title || '';
  titleEl.addEventListener('input', () => { bt.title = titleEl.innerText; debouncedSaveOutline(); });

  const actions = document.createElement('div');
  actions.className = 'bt-actions';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'bt-action bt-toggle';
  toggleBtn.title = bt.collapsed ? T('common.expand','Espandi') : T('common.collapse','Compatta');
  toggleBtn.textContent = bt.collapsed ? '▾' : '▴';
  toggleBtn.addEventListener('click', () => {
    bt.collapsed = !bt.collapsed; saveOutline(); renderBeats();
  });

  const upBtn = document.createElement('button');
  upBtn.className = 'bt-action';
  upBtn.title = T('common.moveUp','Sposta su');
  upBtn.textContent = '↑';
  upBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    const ordered = [...beatsData].sort((a,b)=>(a.ordering??0)-(b.ordering??0));
    const pos = ordered.findIndex(x => x.id === bt.id);
    if (pos <= 0) return;
    const prev = ordered[pos - 1];
    const curOrd  = bt.ordering ?? 0;
    const prevOrd = prev.ordering ?? 0;
    bt.ordering   = prevOrd;
    prev.ordering = curOrd;
    normalizeBeatsOrdering();
    saveOutline();
    renderBeats();
    focusBeatTitle(bt.id);
  });

  const downBtn = document.createElement('button');
  downBtn.className = 'bt-action';
  downBtn.title = T('common.moveDown','Sposta giù');
  downBtn.textContent = '↓';
  downBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    const ordered = [...beatsData].sort((a,b)=>(a.ordering??0)-(b.ordering??0));
    const pos = ordered.findIndex(x => x.id === bt.id);
    if (pos === -1 || pos >= ordered.length - 1) return;
    const next = ordered[pos + 1];
    const curOrd  = bt.ordering ?? 0;
    const nextOrd = next.ordering ?? 0;
    bt.ordering   = nextOrd;
    next.ordering = curOrd;
    normalizeBeatsOrdering();
    saveOutline();
    renderBeats();
    focusBeatTitle(bt.id);
  });

  const addSectionBtn = document.createElement('button');
  addSectionBtn.className = 'bt-action inline-add-btn';
  addSectionBtn.title = T('editor.custom.add','Aggiungi sezione personalizzata');
  addSectionBtn.textContent = T('editor.custom.addShort','+ Sezione');
  addSectionBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    if (!Array.isArray(bt.customFields)) bt.customFields = [];
    bt.customFields.push(newCustomField());
    saveOutline();
    renderBeats();
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'bt-close ev-close';
  delBtn.title = T('common.delete','Elimina');
  delBtn.textContent = '✕';
  delBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);

  delBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReadOnly) return;

    const idx = beatsData.findIndex(x => x.id === bt.id);
    if (idx === -1) return;

    const snapshot = { ...bt };

    beatsData.splice(idx, 1);
    normalizeBeatsOrdering();
    saveOutline();
    renderBeats();
    applyReadOnlyStateOutline();

    const nextIdx = Math.min(idx, beatsData.length - 1);
    if (nextIdx >= 0) focusBeatTitle(beatsData[nextIdx].id);

    showUndoToast(T('editor.outline.removed','Beat eliminato.'), () => {
      const insertAt = Math.max(0, Math.min(idx, beatsData.length));
      beatsData.splice(insertAt, 0, snapshot);
      normalizeBeatsOrdering();
      saveOutline();
      renderBeats();
      applyReadOnlyStateOutline();
      focusBeatTitle(snapshot.id);
    }, { undoLabel: T('common.undo','Annulla') });
  });

  actions.appendChild(toggleBtn);
  actions.appendChild(upBtn);
  actions.appendChild(downBtn);
  actions.appendChild(addSectionBtn);
  header.appendChild(idxEl);
  header.appendChild(titleEl);
  header.appendChild(actions);
  header.appendChild(delBtn);

  const body = document.createElement('div');
  body.className = 'bt-body';
  if (bt.collapsed) body.style.display = 'none';

  const pushBeatField = (label, cls, key, multiline=false, placeholder='') => {
    const row = document.createElement('div');
    row.className = 'bt-field';

    const lab = document.createElement('div');
    lab.className = 'bt-label';
    lab.textContent = label;

    const inp = document.createElement('div');
    inp.className = 'bt-input ' + (multiline ? 'bt-multiline' : 'bt-line') + ' ' + cls;
    inp.contentEditable = String(!isReadOnly);
    if (placeholder) inp.setAttribute('data-placeholder', placeholder);
    inp.innerText = bt[key] || '';
    const handler = () => { bt[key] = inp.innerText; debouncedSaveOutline(); };
    inp.addEventListener('input', handler);
    inp.addEventListener('blur', handler);


    row.appendChild(lab);
    row.appendChild(inp);
    body.appendChild(row);
  };

  pushBeatField(T('editor.outline.summary','Sintesi breve'), 'bt-summary', 'summary', true, T('editor.outline.summaryPh','2-3 righe sul beat…'));
  pushBeatField(T('editor.outline.objective','Obiettivo'), 'bt-obj', 'objective', true, T('editor.outline.objectivePh','cosa vuole ottenere il protagonista in questo beat…'));
  pushBeatField(T('editor.outline.obstacle','Conflitto / Ostacolo'), 'bt-obs', 'obstacle', true, T('editor.outline.obstaclePh','cosa si mette di traverso…'));
  pushBeatField(T('editor.outline.outcome','Esito / Cambio'), 'bt-out', 'outcome', true, T('editor.outline.outcomePh','cosa cambia alla fine del beat…'));
  pushBeatField(T('editor.outline.timePlace','Tempo & Luogo'), 'bt-whenwhere', 'timePlace', false, T('editor.outline.timePlacePh','giorno/notte, luogo, interni/esterni…'));
  pushBeatField(T('editor.outline.characters','Personaggi'), 'bt-chars', 'characters', true, T('editor.outline.charactersPh','coinvolti (nomi separati da virgola)…'));
  pushBeatField(T('editor.outline.links','Collegamenti'), 'bt-links', 'links', true, T('editor.outline.linksPh','timeline, personaggi, riferimenti…'));

  const contRow = document.createElement('div');
  contRow.className = 'bt-field';
  const contLab = document.createElement('div');
  contLab.className = 'bt-label';
  contLab.textContent = outlineContainerLabel();
  const contInp = document.createElement('div');
  contInp.className = 'bt-input bt-line bt-container';
  contInp.contentEditable = String(!isReadOnly);
  contInp.setAttribute('data-placeholder', `${outlineContainerLabel()}…`);
  contInp.innerText = bt.container || '';
  const contH = () => { bt.container = contInp.innerText; debouncedSaveOutline(); };
  contInp.addEventListener('input', contH);
  contInp.addEventListener('blur',  contH);
  contRow.appendChild(contLab);
  contRow.appendChild(contInp);
  body.appendChild(contRow);

  // sezioni personalizzate locali
  const cfList = Array.isArray(bt.customFields) ? bt.customFields : [];
  cfList.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'bt-field bt-custom-row';

    const lab = document.createElement('div');
    lab.className = 'bt-label';
    lab.setAttribute('data-placeholder', T('editor.custom.section','Sezione personalizzata'));

    const labText = document.createElement('span');
    labText.className = 'label-text';
    labText.textContent = (f.title || '');
    labText.setAttribute('data-placeholder', T('editor.custom.section','Sezione personalizzata'));
    labText.contentEditable = String(!isReadOnly);
    if (!f.title) labText.textContent = '';
    labText.addEventListener('input', () => {
      f.title = labText.textContent.trim();
      saveOutline();
    });

    const beatCtrls = document.createElement('div');
    beatCtrls.className = 'field-ctrls';

    const beatDelSecBtn = document.createElement('button');
    beatDelSecBtn.type = 'button';
    beatDelSecBtn.title = T('common.deleteSection','Elimina sezione');
    beatDelSecBtn.textContent = '✕';
    beatDelSecBtn.addEventListener('click', () => {
      if (isReadOnly) return;
      const i = bt.customFields.findIndex(x => x.id === f.id);
      if (i !== -1) {
        const snapshot = { ...f };
        bt.customFields.splice(i, 1);
        saveOutline();
        renderBeats();
        showUndoToast(T('editor.custom.removed','Sezione rimossa.'), () => {
          bt.customFields.splice(Math.min(i, bt.customFields.length), 0, snapshot);
          saveOutline();
          renderBeats();
        }, { undoLabel: T('common.undo','Annulla') });
      }
    });
    beatCtrls.appendChild(beatDelSecBtn);

    lab.appendChild(labText);
    lab.appendChild(beatCtrls);

    const inp = document.createElement('div');
    inp.className = 'bt-input bt-multiline';
    inp.contentEditable = String(!isReadOnly);
    inp.setAttribute('data-placeholder', T('editor.custom.textPh','Testo…'));
    inp.innerText = f.value || '';
    const onChange = () => { f.value = inp.innerText; debouncedSaveOutline(); };
    inp.addEventListener('input', onChange);
    inp.addEventListener('blur', onChange);

    row.appendChild(lab);
    row.appendChild(inp);
    body.appendChild(row);
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}


function normalizeBeatsOrdering(){
  const sorted = [...beatsData].sort((a,b)=>(a.ordering??0)-(b.ordering??0));
  let o = 10;
  sorted.forEach(b => { b.ordering = o; o += 10; });
}
function focusBeatTitle(id){
  const el = beatList.querySelector(`[data-id="${id}"] .bt-title`);
  if (el) {
    requestAnimationFrame(() => {
      el.focus();
      const r = document.createRange(); const s = window.getSelection();
      r.selectNodeContents(el); r.collapse(false);
      s.removeAllRanges(); s.addRange(r);
    });
  }
}

function applyReadOnlyStateOutline(){
  if (!beatUI) return;
  beatUI.classList.toggle('beat-readonly', isReadOnly);
  beatUI.querySelectorAll('.bt-input, .bt-title').forEach(el => {
    el.setAttribute('contenteditable', String(!isReadOnly));
  });
  beatUI.querySelectorAll('.bt-action, .bt-close, .beat-add-btn')
    .forEach(btn => { btn.disabled = isReadOnly; });
}
/* =========================
   BIBBIA — Blocchi collassabili + Toolbar (ricerca + +Sezione)
   ========================= */
let bibleData = [];    // [{id,title,content,collapsed}]
let bibleUI = null;
let bibleList = null;
let bibleSearchInput = null;

function newBibleCustomSection() {
  return {
    id: 'custom_' + Math.random().toString(36).slice(2,9),
    title: '',            // ⬅️ prima era 'SEZIONE PERSONALIZZATA'
    content: '',
    collapsed: false
  };
}

function bibleDefaults() {
  return [
    { id:'title',          title: T('editor.bible.title','TITOLO'),          ph: T('editor.bible.ph.title','Titolo del progetto, eventuale sottotitolo…') },
    { id:'author',         title: T('editor.bible.author','AUTORE'),         ph: T('editor.bible.ph.author','Nome/i autore/i, contatti, eventuale ruolo…') },
    { id:'pitch',          title: T('editor.bible.pitch','PITCH / LOGLINE'), ph: T('editor.bible.ph.pitch','Una o due frasi che catturano il cuore della storia…') },
    { id:'premise',        title: T('editor.bible.premise','PREMESSA'),      ph: T('editor.bible.ph.premise','Idea di fondo e “e se…?”, tono generale…') },
    { id:'synopsisShort',  title: T('editor.bible.synShort','SINOSSI BREVE'), ph:T('editor.bible.ph.synShort','5–10 righe sulla storia dall’inizio alla fine…') },
    { id:'synopsisLong',   title: T('editor.bible.synLong','SINOSSI ESTESA'), ph:T('editor.bible.ph.synLong','2–3 paragrafi: setup, sviluppo, climax e finale…') },
    { id:'themes',         title: T('editor.bible.themes','TEMI'),            ph:T('editor.bible.ph.themes','Temi portanti (crescita, colpa, redenzione…), perché ti interessano…') },
    { id:'toneStyle',      title: T('editor.bible.tone','TONO & STILE'),      ph:T('editor.bible.ph.tone','Registro (dramma, commedia nera…), ritmo, opere di riferimento…') },
    { id:'worldOverview',  title: T('editor.bible.world','MONDO / AMBIENTAZIONE'), ph:T('editor.bible.ph.world','Contesto sociale/storico, norme culturali, particolarità…') },
    { id:'worldRules',     title: T('editor.bible.rules','REGOLE DEL MONDO'),     ph:T('editor.bible.ph.rules','Magia/tecnologia/sovrannaturale: cosa è possibile e cosa no…') },
    { id:'locations',      title: T('editor.bible.locations','LUOGHI CHIAVE'),    ph:T('editor.bible.ph.locations','Set principali e loro funzione narrativa…') },
    { id:'timePeriod',     title: T('editor.bible.period','PERIODO/EPOCA'),       ph:T('editor.bible.ph.period','Epoca, arco temporale, cronologia macro…') },
    { id:'structureNotes', title: T('editor.bible.structure','STRUTTURA'),        ph:T('editor.bible.ph.structure','3 atti / 5 atti / 8 sequenze… snodi principali…') },
    { id:'motifs',         title: T('editor.bible.motifs','MOTIVI & SIMBOLI'),    ph:T('editor.bible.ph.motifs','Oggetti ricorrenti, immagini guida, colori…') },
    { id:'props',          title: T('editor.bible.props','OGGETTI CHIAVE'),       ph:T('editor.bible.ph.props','Elementi fisici importanti e loro significato…') },
    { id:'references',     title: T('editor.bible.refs','RIFERIMENTI & MOODBOARD'), ph:T('editor.bible.ph.refs','Opere affini, palette, link (testuali)…') },
    { id:'production',     title: T('editor.bible.production','NOTE DI PRODUZIONE'), ph:T('editor.bible.ph.production','Vincoli, target, rating, formati…') },
    { id:'glossary',       title: T('editor.bible.glossary','GLOSSARIO'),         ph:T('editor.bible.ph.glossary','Termini interni, nomi propri con definizione…') },
    { id:'bibliography',   title: T('editor.bible.biblio','FONTI & BIBLIOGRAFIA'), ph:T('editor.bible.ph.biblio','Libri, articoli, interviste, ricerche…') },
    { id:'openQuestions',  title: T('editor.bible.questions','QUESTIONI APERTE'),  ph:T('editor.bible.ph.questions','Dubbi da risolvere, punti da testare…') }
  ];
}


/* Merge sicuro + rimozione "meta" */
function ensureBibleDefaults() {
  const defs = bibleDefaults();
  if (!Array.isArray(bibleData)) bibleData = [];

  const existingById = new Map(bibleData.map(s => [s.id, s]));
  const existingMeta = existingById.get('meta');

  const merged = defs.map(d => {
    if (d.id === 'title') {
      const curTitle = existingById.get('title');
      const contentFromMeta = (!curTitle || !curTitle.content) && existingMeta ? (existingMeta.content || '') : '';
      return {
        id: 'title',
        title: d.title,
        content: curTitle?.content || contentFromMeta,
        collapsed: curTitle?.collapsed || false
      };
    }
    const cur = existingById.get(d.id);
    return {
      id: d.id,
      title: d.title,
      content: cur?.content || '',
      collapsed: cur?.collapsed || false
    };
  });

  // Mantieni eventuali sezioni extra (incluse le custom_)
  bibleData.forEach(s => {
    if (s.id === 'meta') return;
    if (!defs.some(d => d.id === s.id) && !merged.some(m => m.id === s.id)) merged.push(s);
  });

  bibleData = merged;
}

async function loadBible() {
  try {
    const raw = await ipcRenderer.invoke('load-content', projectName, 'bibbia');
    if (!raw?.trim()) { bibleData = []; return; }
    bibleData = JSON.parse(raw);
    if (!Array.isArray(bibleData)) bibleData = [];
  } catch { bibleData = []; }
}
async function saveBible() {
  try {
    const payload = JSON.stringify(bibleData, null, 2);
    await ipcRenderer.invoke('save-content', payload, projectName, 'bibbia');
    console.log(`[${projectName}] Bibbia salvata correttamente.`);
  } catch (e) {
    console.error('saveBible error:', e);
  }
}


function buildBibleUI() {
  if (bibleUI) {
    bibleUI.style.display = 'flex';
    editorArea.appendChild(bibleUI);
    return;
  }
  bibleUI = document.createElement('div');
  bibleUI.className = 'bible-wrap';

  const bar = document.createElement('div');
  bar.className = 'bible-toolbar';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'bible-search-wrap';

  bibleSearchInput = document.createElement('input');
  bibleSearchInput.type = 'search';
  bibleSearchInput.placeholder = T('editor.bible.searchPh','Cerca nelle sezioni della Bibbia…');
  bibleSearchInput.className = 'bible-search';
  bibleSearchInput.addEventListener('input', () => {
    renderBible();
    clearBtn.style.display = (bibleSearchInput.value ? 'inline-flex' : 'none');
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'bible-search-clear';
  clearBtn.textContent = '✕';
  clearBtn.setAttribute('aria-label', T('common.clear','Pulisci ricerca'));
  clearBtn.style.display = 'none';
  clearBtn.addEventListener('click', () => {
    bibleSearchInput.value = '';
    renderBible();
    clearBtn.style.display = 'none';
    bibleSearchInput.focus();
  });

  const addBibleSectionBtn = document.createElement('button');
  addBibleSectionBtn.type = 'button';
  addBibleSectionBtn.className = 'bible-add-btn';
  addBibleSectionBtn.textContent = T('editor.custom.addShort','+ Sezione');
  addBibleSectionBtn.title = T('editor.custom.add','Aggiungi sezione personalizzata');
  addBibleSectionBtn.addEventListener('click', () => {
    if (isReadOnly) return;
    const sec = newBibleCustomSection();
    bibleData.push(sec);
    saveBible();
    renderBible();
    const el = bibleList.querySelector(`.bb-card[data-id="${sec.id}"] .bb-title`);
    if (el) el.focus();
  });

  searchWrap.appendChild(bibleSearchInput);
  searchWrap.appendChild(clearBtn);
  bar.appendChild(searchWrap);
  bar.appendChild(addBibleSectionBtn);

  bibleList = document.createElement('div');
  bibleList.className = 'bible-list';

  editorArea.appendChild(bibleUI);
  bibleUI.appendChild(bar);
  bibleUI.appendChild(bibleList);
}


function destroyBibleUI() {
  if (!bibleUI) return;
  if (bibleUI.parentElement === editorArea) editorArea.removeChild(bibleUI);
  bibleUI.style.display = 'none';
}

function renderBible() {
  if (!bibleList) return;
  bibleList.innerHTML = '';

  const q = (bibleSearchInput?.value || '').trim().toLowerCase();
  const items = bibleData.filter(s =>
    !q ||
    (s.title || '').toLowerCase().includes(q) ||
    (s.content || '').toLowerCase().includes(q)
  );

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'bb-empty';
    empty.textContent = T('editor.bible.empty','Nessuna sezione trovata.');
    bibleList.appendChild(empty);
    return;
  }

  items.forEach(sec => bibleList.appendChild(createBibleSection(sec)));

  applyReadOnlyStateBible();
}


function createBibleSection(sec) {
  const card = document.createElement('div');
  card.className = 'bb-card';
  card.dataset.id = sec.id;

  const header = document.createElement('div');
  header.className = 'bb-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'bb-title';
  titleEl.textContent = sec.title || '';
  titleEl.setAttribute('data-placeholder', T('editor.custom.section','Sezione personalizzata'));

  const isCustom = sec.id?.startsWith('custom_');
  if (isCustom) {
    titleEl.setAttribute('contenteditable', String(!isReadOnly));
    titleEl.addEventListener('input', () => {
    sec.title = (titleEl.textContent || '').trim().toUpperCase();
    titleEl.textContent = sec.title;
    placeCaretAtEnd(titleEl);
    debouncedSaveBible();
    });

  }

  const actions = document.createElement('div');
  actions.className = 'bb-actions';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'bb-action bb-toggle';
  toggleBtn.textContent = sec.collapsed ? '▾' : '▴';
  toggleBtn.title = sec.collapsed ? T('common.expand','Espandi') : T('common.collapse','Compatta');
  toggleBtn.addEventListener('click', () => {
    sec.collapsed = !sec.collapsed;
    saveBible();
    renderBible();
  });
  actions.appendChild(toggleBtn);

  if (isCustom) {
    const delBtn = document.createElement('button');
    delBtn.className = 'bb-action bb-close';
    delBtn.textContent = '✕';
    delBtn.title = T('common.deleteSection','Elimina sezione');
    delBtn.addEventListener('click', () => {
      if (isReadOnly) return;
      const idx = bibleData.findIndex(s => s.id === sec.id);
      if (idx === -1) return;
      const snapshot = { ...sec };
      bibleData.splice(idx, 1);
      saveBible();
      renderBible();
      showUndoToast(T('editor.bible.sectionRemoved','Sezione Bibbia eliminata.'), () => {
        bibleData.splice(Math.min(idx, bibleData.length), 0, snapshot);
        saveBible();
        renderBible();
      }, { undoLabel: T('common.undo','Annulla') });
    });
    actions.appendChild(delBtn);
  }

  header.appendChild(titleEl);
  header.appendChild(actions);

  const body = document.createElement('div');
  body.className = 'bb-body';
  if (sec.collapsed) body.style.display = 'none';

  const input = document.createElement('div');
  input.className = 'bb-input bb-multiline';
  input.contentEditable = String(!isReadOnly);

  const def = bibleDefaults().find(d => d.id === sec.id);
  input.setAttribute('data-placeholder', def?.ph || T('editor.custom.textPh','Testo…'));

  input.innerText = sec.content || '';
  const handler = () => { sec.content = input.innerText; debouncedSaveBible(); };
  input.addEventListener('input', handler);
  input.addEventListener('blur', handler);


  body.appendChild(input);

  card.appendChild(header);
  card.appendChild(body);
  return card;
}


function applyReadOnlyStateBible() {
  if (!bibleUI) return;
  bibleUI.classList.toggle('bible-readonly', isReadOnly);
  bibleUI.querySelectorAll('.bb-input').forEach(el => {
    el.setAttribute('contenteditable', String(!isReadOnly));
  });
bibleUI.querySelectorAll('.bb-action, .bible-add-btn').forEach(btn => {
     btn.disabled = isReadOnly;
   });
}

/* =========================
   VERSIONI — Modale / Overlay
   ========================= */

let versionsModalEl = null;
let versionsListEl  = null;
let versionsBusy    = false;

function buildVersionsModal(){
  if (versionsModalEl) return versionsModalEl;

  const wrap = document.createElement('div');
  wrap.id = 'versionsOverlay';
  wrap.style.cssText = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.45); z-index:4000; padding:20px;
  `;

  const panel = document.createElement('div');
  panel.className = 'versions-panel';
  panel.style.cssText = `
    width: min(880px, 95vw);
    max-height: min(78vh, 820px);
    background: var(--panel-bg, #1f1f1f);
    color: inherit;
    border: 1px solid rgba(127,127,127,0.25);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,.45);
    display:flex; flex-direction:column;
  `;

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid rgba(127,127,127,0.25);';

  const hTitle = document.createElement('div');
  hTitle.textContent = T('editor.versions.title','Versioni');
  hTitle.style.cssText = 'font-weight:700; letter-spacing:.02em;';

  const rightWrap = document.createElement('div');
  rightWrap.style.cssText = 'display:inline-flex; align-items:center; gap:8px;';

  const form = document.createElement('form');
  form.id = 'versionCreateForm';
  form.style.cssText = 'display:inline-flex; gap:6px; align-items:center;';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createVersionSnapshot();
  });

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'versionLabelInput';
  input.placeholder = T('editor.versions.labelPh','Etichetta versione…');
  input.style.cssText =
    'min-width:220px; padding:6px 8px; border-radius:8px; border:1px solid rgba(127,127,127,0.35); background:transparent; color:inherit;';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn';
  submitBtn.textContent = T('common.create','Crea');

  form.appendChild(input);
  form.appendChild(submitBtn);

  const btnClose = document.createElement('button');
  btnClose.className = 'btn';
  btnClose.textContent = T('common.close','Chiudi');
  btnClose.addEventListener('click', closeVersionsPanel);

  rightWrap.appendChild(form);
  rightWrap.appendChild(btnClose);

  header.appendChild(hTitle);
  header.appendChild(rightWrap);

  const body = document.createElement('div');
  body.style.cssText = 'padding:10px 12px; overflow:auto;';

  const list = document.createElement('div');
  list.id = 'versionsList';
  list.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
  body.appendChild(list);

  const footer = document.createElement('div');
  footer.style.cssText =
    'padding:10px 12px; border-top:1px solid rgba(127,127,127,0.25); opacity:.75; font-size:13px;';
  footer.textContent =
    T('editor.versions.footer','Le versioni sono snapshot in sola lettura del progetto. Puoi creare, ripristinare o eliminare versioni.');

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);
  wrap.appendChild(panel);

  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeVersionsPanel(); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeVersionsPanel(); });

  versionsModalEl = wrap;
  versionsListEl  = list;
  return wrap;
}

function openVersionsPanel(){
  if (versionsModalEl?.isConnected) return;
  document.body.appendChild(buildVersionsModal());
  refreshVersionsList();
  // focus sull’input alla apertura
  const input = document.getElementById('versionLabelInput');
  if (input) input.focus();
}

function closeVersionsPanel(){
  if (versionsModalEl && versionsModalEl.parentNode) {
    versionsModalEl.parentNode.removeChild(versionsModalEl);
  }
}

async function refreshVersionsList(){
  if (!versionsListEl || versionsBusy) return;
  versionsBusy = true;
  versionsListEl.innerHTML = T('common.loading','Carico…');

  try {
    const rows = await ipcRenderer.invoke('versions:list', projectName);
    versionsListEl.innerHTML = '';
    if (!rows || !rows.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:.7; font-style:italic; padding:8px;';
      empty.textContent = T('editor.versions.none','Nessuna versione salvata.');
      versionsListEl.appendChild(empty);
      return;
    }
    rows.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    rows.forEach(renderVersionRow);
  } catch (e) {
    versionsListEl.textContent = T('editor.versions.loadErr','Errore nel caricamento delle versioni.');
  } finally {
    versionsBusy = false;
  }
}

function renderVersionRow(v){
  const row = document.createElement('div');
  row.style.cssText = `
    border:1px solid rgba(127,127,127,0.25);
    border-radius:10px; padding:10px 12px;
    display:grid; grid-template-columns: minmax(0,1fr) auto; gap:10px; align-items:center;
    background: rgba(127,127,127,0.06);
  `;

  const left = document.createElement('div');
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:700;';
  title.textContent = v.label || T('editor.versions.untitled','(senza titolo)');

  const meta = document.createElement('div');
  meta.style.cssText = 'font-size:13px; opacity:.8;';
  const d = new Date(v.createdAt || Date.now());
  const sectionLabel = T('editor.versions.section','sezione');
  meta.textContent = `${d.toLocaleString()} • ${v.sizeHuman || ''} ${v.section ? `• ${sectionLabel}: ${v.section}` : ''}`;

  left.appendChild(title);
  left.appendChild(meta);

  const right = document.createElement('div');
  right.style.cssText = 'display:inline-flex; gap:8px;';

  const btnRestore = document.createElement('button');
  btnRestore.className = 'btn';
  btnRestore.textContent = T('editor.versions.restore','Ripristina');
  btnRestore.onclick = () => restoreVersion(v.id);

  const btnDelete = document.createElement('button');
  btnDelete.className = 'btn';
  btnDelete.textContent = T('common.delete','Elimina');
  btnDelete.onclick = () => deleteVersion(v.id);

  right.appendChild(btnRestore);
  right.appendChild(btnDelete);

  row.appendChild(left);
  row.appendChild(right);

  versionsListEl.appendChild(row);
}

/* === Azioni === */
async function createVersionSnapshot(){
  const input = document.getElementById('versionLabelInput');
  const label = (input?.value || `${T('editor.versions.snapshot','Snapshot')} ${new Date().toLocaleString()}`).trim();

  try {
    const res = await ipcRenderer.invoke('versions:create', projectName, { label });
    if (!res?.success) throw new Error(res?.error || 'sconosciuto');

    if (input) input.value = '';
    await refreshVersionsList();
    closeVersionsPanel();
    showToast(T('editor.versions.created','✅ Versione creata.'));
  } catch (err) {
    showToast(T('editor.versions.createErr','❌ Errore creazione versione: ') + err.message);
  }
}

async function restoreVersion(versionId){
  const ok = await showConfirmToast(
    T('editor.versions.restoreConfirm','Ripristinare questa versione? Il contenuto attuale verrà sovrascritto.'),
    { okLabel: T('editor.versions.restore','Ripristina'), cancelLabel: T('common.cancel','Annulla') }
  );
  if (!ok) return;

  try {
    const res = await ipcRenderer.invoke('versions:restore', projectName, versionId);
    if (!res?.success) throw new Error(res?.error || 'sconosciuto');

    closeVersionsPanel();
    await loadSection(currentSection);

    // riporta in scrittura
    isReadOnly = false;
    applyReadOnlyState();
    applyTimelineReadOnly?.();
    applyReadOnlyStateCharacters?.();
    applyReadOnlyStateOutline?.();
    applyReadOnlyStateBible?.();
    focusCurrentEditor();

    showToast(T('editor.versions.restored','✅ Versione ripristinata.'));
  } catch (err) {
    showToast(T('editor.versions.restoreErr','❌ Errore ripristino: ') + err.message);
  }
}

async function deleteVersion(versionId){
  const ok = await showConfirmToast(
    T('editor.versions.deleteConfirm','Eliminare definitivamente questa versione?'),
    { okLabel: T('common.delete','Elimina'), cancelLabel: T('common.cancel','Annulla') }
  );
  if (!ok) return;

  try {
    const res = await ipcRenderer.invoke('versions:delete', projectName, versionId);
    if (!res?.success) throw new Error(res?.error || 'sconosciuto');

    await refreshVersionsList();
    closeVersionsPanel();

    isReadOnly = false;
    applyReadOnlyState();
    focusCurrentEditor();

    showToast(T('editor.versions.deleted','🗑️ Versione eliminata.'));
  } catch (err) {
    showToast(T('editor.versions.deleteErr','❌ Errore eliminazione: ') + err.message);
  }
}


/* =========================
   Pulsanti globali (in aggiunta agli on* inline)
   ========================= */

const backBtn = document.getElementById('backToMenuBtn');
if (backBtn) backBtn.addEventListener('click', () => { window.location.href = 'index.html'; });

// ❌ RIMOSSI: non esistono più questi elementi in HTML
// const exportBtn = document.getElementById('exportBtn');
// if (exportBtn) exportBtn.addEventListener('click', exportFullPDF);
// const exportSectionBtn = document.getElementById('exportSectionBtn');
// if (exportSectionBtn) exportSectionBtn.addEventListener('click', exportCurrentSectionPDF);

const themeBtn = document.getElementById('themeToggle');
if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

// ✅ Applica subito il tema salvato all'avvio
(function applySavedTheme() {
  const saved = localStorage.getItem('uiTheme');
  const body = document.body;
  body.classList.remove('light', 'dark');
  if (saved === 'dark' || saved === 'light') {
    body.classList.add(saved);
  } else {
    body.classList.add('light'); // default
  }
})();


/* ===== Adapter voci menu Versioni (HTML chiama ancora queste) ===== */
function saveVersion() {
  // Apre il pannello e mette il focus sull’input per la label
  openVersionsPanel();
  const input = document.getElementById('versionLabelInput');
  if (input) input.focus();
}

function openRestoreVersionDialog() {
  // Per ora usiamo lo stesso pannello “Versioni”
  openVersionsPanel();
}

function openVersionsManager() {
  // Gestisce: elenco + crea/elimina/ripristina
  openVersionsPanel();
}

/* =========================
   Split button "Versioni" — comportamento definitivo
   ========================= */
(function initVersionsSplit(){
  const versionsSplit      = document.getElementById('versionsSplit');
  const versionsMainBtn    = document.getElementById('versionsMainBtn');
  const versionsMenuToggle = document.getElementById('versionsMenuToggle');
  const versionsMenu       = document.getElementById('versionsMenu');

  function openVersionsMenu() {
    if (!versionsMenu || !versionsMainBtn || !versionsMenuToggle) return;
    versionsMenu.hidden = false;
    versionsMainBtn.setAttribute('aria-expanded', 'true');
    versionsMenuToggle.setAttribute('aria-expanded', 'true');
    const first = versionsMenu.querySelector('.menu-item');
    if (first) first.focus();
  }
  function closeVersionsMenu() {
    if (!versionsMenu || !versionsMainBtn || !versionsMenuToggle) return;
    versionsMenu.hidden = true;
    versionsMainBtn.setAttribute('aria-expanded', 'false');
    versionsMenuToggle.setAttribute('aria-expanded', 'false');
  }
  function toggleVersionsMenu() {
    if (!versionsMenu) return;
    versionsMenu.hidden ? openVersionsMenu() : closeVersionsMenu();
  }
  function handleVersionsTriggerKeydown(e) {
    const k = e.key;
    if (k === 'Escape') { closeVersionsMenu(); versionsMainBtn?.focus(); return; }
    if (k === 'Enter' || k === ' ' || k === 'ArrowDown') { e.preventDefault(); openVersionsMenu(); }
  }

  if (versionsSplit && versionsMainBtn && versionsMenuToggle && versionsMenu) {
    // Bottone principale → apre il pannello Versioni
    versionsMainBtn.onclick = () => { closeVersionsMenu(); openVersionsPanel(); };
    // Caret → apre/chiude la tendina
    versionsMenuToggle.onclick = toggleVersionsMenu;

    versionsMainBtn.onkeydown = handleVersionsTriggerKeydown;
    versionsMenuToggle.onkeydown = handleVersionsTriggerKeydown;

    // Chiudi al click fuori
    document.addEventListener('click', (e) => {
      if (!versionsSplit.contains(e.target)) closeVersionsMenu();
    });
    // Chiudi con ESC dentro il menu
    versionsMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeVersionsMenu(); versionsMainBtn.focus(); }
    });
    // Chiudi dopo click su una voce
    versionsMenu.addEventListener('click', (e) => {
      if (e.target.closest('.menu-item')) closeVersionsMenu();
    });
  }
})();

/* =========================
   Split button "Esporta" — toggle menu + azione default
   ========================= */
(function initExportSplit(){
  const exportSplit      = document.getElementById('exportSplit');
  const exportMainBtn    = document.getElementById('exportMainBtn');
  const exportMenuToggle = document.getElementById('exportMenuToggle');
  const exportMenu       = document.getElementById('exportMenu');

  // ✅ i18n aria-label per il caret (fallback IT se I18N non è inizializzato)
  if (exportMenuToggle) {
    const caretLabel = (window.I18N?.t?.('editor.export.openMenu') ?? 'Apri menu esportazione');
    exportMenuToggle.setAttribute('aria-label', caretLabel);
  }

  function openExportMenu() {
    if (!exportMenu || !exportMainBtn || !exportMenuToggle) return;
    exportMenu.hidden = false;
    exportMainBtn.setAttribute('aria-expanded', 'true');
    exportMenuToggle.setAttribute('aria-expanded', 'true');
    const first = exportMenu.querySelector('.menu-item');
    if (first) first.focus();
  }
  function closeExportMenu() {
    if (!exportMenu || !exportMainBtn || !exportMenuToggle) return;
    exportMenu.hidden = true;
    exportMainBtn.setAttribute('aria-expanded', 'false');
    exportMenuToggle.setAttribute('aria-expanded', 'false');
  }
  function toggleExportMenu() {
    if (!exportMenu) return;
    exportMenu.hidden ? openExportMenu() : closeExportMenu();
  }
  function handleExportTriggerKeydown(e) {
    const k = e.key;
    if (k === 'Escape') { closeExportMenu(); exportMainBtn?.focus(); return; }
    if (k === 'Enter' || k === ' ' || k === 'ArrowDown') { e.preventDefault(); openExportMenu(); }
  }

  if (exportSplit && exportMainBtn && exportMenuToggle && exportMenu) {
    // Azione default del pulsante grande: esporta intero progetto in PDF
    exportMainBtn.onclick = async () => {
      closeExportMenu();
      await exportFullPDF();   // usa già la tua funzione
    };

    // Caret: apre/chiude menu
    exportMenuToggle.onclick = toggleExportMenu;

    exportMainBtn.onkeydown = handleExportTriggerKeydown;
    exportMenuToggle.onkeydown = handleExportTriggerKeydown;

    // Click fuori = chiudi
    document.addEventListener('click', (e) => {
      if (!exportSplit.contains(e.target)) closeExportMenu();
    });

    // ESC dentro il menu
    exportMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeExportMenu(); exportMainBtn.focus(); }
    });

    // Click su una voce del menu: chiudi + azione
    exportMenu.addEventListener('click', async (e) => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      closeExportMenu();

      // Se il tuo HTML ha già onclick inline, non serve altro.
      // Se preferisci guidarlo da JS, puoi usare data-action:
      const action = item.getAttribute('data-action');
      if (action === 'export-project') await exportFullPDF();
      if (action === 'export-section') await exportCurrentSectionPDF();
    });
  }
})();
// =========================
// Scorciatoie modalità scrittura (solo sezione "scene")
// =========================
(function installSceneShortcuts(){
  document.addEventListener('keydown', (e) => {
    // solo sezione "scene" e non in sola lettura
    if (isReadOnly || currentSection !== 'scene') return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (!/^[1-6]$/.test(e.key)) return;

    e.preventDefault();
    e.stopPropagation();

    // 🎭 Mappa scorciatoie per tipo progetto
    let mode = null;

    if (projectType === 'sceneggiatura') {
      switch (e.key) {
        case '1': mode = 'scene-heading'; break; // Intestazione scena
        case '2': mode = 'action'; break;        // Azione
        case '3': mode = 'character'; break;     // Personaggio
        case '4': mode = 'dialogue'; break;      // Dialogo
        case '5': mode = 'parenthetical'; break; // Parentetica
        case '6': mode = 'transition'; break;    // Transizione
      }
    } 
    else if (projectType === 'teatro') {
      switch (e.key) {
        case '1': mode = 'scene-heading'; break;   // Scena
        case '2': mode = 'character'; break;       // Personaggio
        case '3': mode = 'dialogue'; break;        // Dialogo
        case '4': mode = 'stage-direction'; break; // Didascalia
      }
    }

    if (!mode || !writingMode) return;

    writingMode.value = mode;

    // ✅ Feedback discreto (solo console per ora, zero grafica invasiva)
    console.log(`Modalità attiva: ${mode}`);
  });
})();

/* =========================
   Avvio
   ========================= */
(async () => {
  await initI18n();            // <<< PRIMA di tutto
  initSidebarChrome();         // nome progetto + stato tendina (nessuna icona)
  loadProjectType();           // costruisce sezioni e carica l’ultima
})();


// [OPZIONALE] Sync difensivo del toggle dopo il primo paint
requestAnimationFrame(() => {
  const state = layoutRoot?.getAttribute('data-sidebar-state') || 'open';
  if (sidebarToggle) {
    const isOpen = state === 'open';
    const label = isOpen ? T('editor.sidebar.close','Chiudi barra')
                     : T('editor.sidebar.open','Apri barra');

    sidebarToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    sidebarToggle.setAttribute('aria-label', label);
    sidebarToggle.title = label;
  }
});
