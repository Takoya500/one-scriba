/***********************************************************************
 * SCRIPTUM — EXPORTER (v2.0 full)
 * 
 * - Parità 1:1 tra editor e PDF
 * - Scene / Teatro / Capitoli → Courier Prime
 * - Sezioni classiche (note, concept, trattamento, ecc.) → Lora
 * - Font inclusi nella cartella `/fonts`
 * - Fallback automatico a Courier / Times se i .ttf non sono trovati
 * - Liste numerate e puntate corrette (anche annidate)
 * - Supporto per B/I/U, <font size=2|3|4>, <br>, <h1..h3>, UL/OL
 ***********************************************************************/

const fs = require('fs-extra');
const path = require('path');
const PDFDocument = require('pdfkit');
const projectManager = require('./projectManager');

const DEFAULT_LABELS = {
  it: {
    lang: 'it',
    page: 'Pagina',
    sectionTitles: {
      scene: 'Stesura',
      capitoli: 'Capitoli',
      concept: 'Concept',
      soggetto: 'Soggetto',
      trattamento: 'Trattamento',
      scaletta: 'Scaletta',
      bibbia: 'Bibbia',
      personaggi: 'Personaggi',
      timeline: 'Timeline',
      note: 'Note',
      soggetto_logline: 'Soggetto & logline',
      outline: 'Outline',
      didascalie: 'Didascalie',
      premessa_sinossi: 'Premessa & sinossi'
    },
    fields: {
      // Personaggi
      characterHeader: 'Personaggio',
      name: 'Nome',
      role: 'Ruolo',
      ageAppearance: 'Età / Aspetto',
      background: 'Background',
      goal: 'Obiettivo',
      conflict: 'Conflitto',
      arc: 'Evoluzione',
      relationships: 'Relazioni',
      traits: 'Tratti',
      quote: 'Citazione',
      notes: 'Note',
      custom: 'Campo personalizzato',

      // Scaletta
      beatHeader: 'Battuta',
      title: 'Titolo',
      container: 'Sequenza',
      summary: 'Riassunto',
      objective: 'Obiettivo',
      obstacle: 'Ostacolo',
      outcome: 'Esito',
      timePlace: 'Tempo / Luogo',
      characters: 'Personaggi',
      links: 'Collegamenti',

      // Timeline
      timelineEvent: 'Evento',

      // Bibbia
      section: 'Sezione'
    }
  },

  en: {
    lang: 'en',
    page: 'Page',
    sectionTitles: {
      scene: 'Draft',
      capitoli: 'Chapters',
      concept: 'Concept',
      soggetto: 'Story',
      trattamento: 'Treatment',
      scaletta: 'Outline',
      bibbia: 'Bible',
      personaggi: 'Characters',
      timeline: 'Timeline',
      note: 'Notes',
      soggetto_logline: 'Premise & Logline',
      outline: 'Outline',
      didascalie: 'Stage Directions',
      premessa_sinossi: 'Premise & Synopsis'
    },
    fields: {
      // Characters
      characterHeader: 'Character',
      name: 'Name',
      role: 'Role',
      ageAppearance: 'Age / Appearance',
      background: 'Background',
      goal: 'Goal',
      conflict: 'Conflict',
      arc: 'Arc',
      relationships: 'Relationships',
      traits: 'Traits',
      quote: 'Quote',
      notes: 'Notes',
      custom: 'Custom Field',

      // Outline
      beatHeader: 'Beat',
      title: 'Title',
      container: 'Sequence',
      summary: 'Summary',
      objective: 'Objective',
      obstacle: 'Obstacle',
      outcome: 'Outcome',
      timePlace: 'Time / Place',
      characters: 'Characters',
      links: 'Links',

      // Timeline
      timelineEvent: 'Event',

      // Bible
      section: 'Section'
    }
  }
};

function applyProjectTypeOverrides(target, projectType) {
  if (!target || !projectType) return target;
  target.projectType = projectType;
  if (target.lang === 'en' && projectType === 'libro') {
    target.sectionTitles = { ...target.sectionTitles, scaletta: 'Chapter Breakdown' };
  }
  return target;
}


function mergeLabels(labels) {
  const lang = (labels && labels.lang) || 'it';
  const base = DEFAULT_LABELS[lang] || DEFAULT_LABELS.it;
  const merged = {
    ...base,
    ...(labels || {}),
    sectionTitles: { ...base.sectionTitles, ...(labels?.sectionTitles || {}) }
  };
  return applyProjectTypeOverrides(merged, labels?.projectType);
}

function decodeEntities(s = '') {
  return String(s || '')
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(s = '') {
  return String(s).replace(/<\/?[^>]+>/g, '');
}

function htmlToPlainText(s = '') {
  // Ritaglia solo il contenuto, togliendo eventuali wrapper page-content
  const inner = extractPageContent(s);
  // Sostituisci BR con newline, decodifica entità, rimuovi i tag
  return decodeEntities(
    stripTags(
      String(inner || '').replace(/<br\s*\/?>/gi, '\n')
    )
  ).replace(/\u00A0/g, ' ').trim();
}

/* ======================================================================
   SECTION LABEL — titolo sezione (centrato in PDF)
   ====================================================================== */
function sectionLabel(sectionId, labels) {
  const raw =
    labels?.sectionTitles?.[sectionId] ||
    (sectionId ? sectionId.charAt(0).toUpperCase() + sectionId.slice(1) : sectionId);
  return String(raw || '').toUpperCase();
}

/* ======================================================================
   FOOTER E INFO PDF
   ====================================================================== */
function drawPageNumber(doc, pageNum, labels) {
  const text = `${labels.page} ${pageNum}`;
  const y = doc.page.height - doc.page.margins.bottom - 12;
  const w = doc.widthOfString(text);
  const x = (doc.page.width - w) / 2;
  doc.font('Serif').fontSize(9).fillColor('#555').text(text, x, y);
}

function numberAllPages(doc, labels) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawPageNumber(doc, i + 1, labels);
  }
  doc.switchToPage(range.start + range.count - 1);
}

function applyPdfInfo(doc, { title, subject }) {
  const now = new Date();
  doc.info = {
    Title: title || 'Scriptum Export',
    Subject: subject || '',
    Creator: 'Scriptum',
    Producer: 'PDFKit',
    CreationDate: now,
    ModDate: now
  };
}

/* ======================================================================
   REGISTER FONTS (Courier Prime + Lora, con fallback)
   ====================================================================== */
function registerFonts(doc) {
  const fontsDir = path.join(__dirname, '../..', 'fonts');
  const f = (name) => path.join(fontsDir, name);

  const mono = {
    reg: f('CourierPrime-Regular.ttf'),
    bold: f('CourierPrime-Bold.ttf'),
    it: f('CourierPrime-Italic.ttf'),
    boldIt: f('CourierPrime-BoldItalic.ttf')
  };
  const serif = {
    reg: f('Lora-Regular.ttf'),
    bold: f('Lora-Bold.ttf'),
    it: f('Lora-Italic.ttf'),
    boldIt: f('Lora-BoldItalic.ttf')
  };
  const exists = (p) => {
    try { return fs.existsSync(p); } catch { return false; }
  };

  // Courier Prime
  if (exists(mono.reg)) {
    doc.registerFont('Mono', mono.reg);
    doc.registerFont('Mono-Bold', mono.bold);
    doc.registerFont('Mono-Oblique', mono.it);
    doc.registerFont('Mono-BoldOblique', mono.boldIt);
  } else {
    doc.registerFont('Mono', 'Courier');
    doc.registerFont('Mono-Bold', 'Courier-Bold');
    doc.registerFont('Mono-Oblique', 'Courier-Oblique');
    doc.registerFont('Mono-BoldOblique', 'Courier-BoldOblique');
  }

  // Lora
  if (exists(serif.reg)) {
    doc.registerFont('Serif', serif.reg);
    doc.registerFont('Serif-Bold', serif.bold);
    doc.registerFont('Serif-Italic', serif.it);
    doc.registerFont('Serif-BoldItalic', serif.boldIt);
  } else {
    doc.registerFont('Serif', 'Times-Roman');
    doc.registerFont('Serif-Bold', 'Times-Bold');
    doc.registerFont('Serif-Italic', 'Times-Italic');
    doc.registerFont('Serif-BoldItalic', 'Times-BoldItalic');
  }
}

/* ======================================================================
   SCENE RENDERER (invariato)
   ====================================================================== */
function extractPageContent(html) {
  const m = /<div[^>]*class="[^"]*page-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  return m ? m[1] : html;
}

// --- FIX HTML LIST NESTING (prudente: non cambia il tipo della lista) ---
function fixBrokenLists(html = '') {
  return String(html)
    // 🩹 retrocompatibilità: converte vecchi <div class="ul"> o <p class="ol"> in vere liste
    .replace(/<(div|p)[^>]*class="[^"]*\bul\b[^"]*"[^>]*>/gi, '<ul>')
    .replace(/<(div|p)[^>]*class="[^"]*\bol\b[^"]*"[^>]*>/gi, '<ol>')
    .replace(/<\/(div|p)>/gi, '</li>') // chiusura prudente per legacy block
    // chiude eventuali <ul> o <ol> non chiuse (solo se bilancio mancante)
    .replace(/<ul>(?![\s\S]*?<\/ul>)/gi, '<ul></ul>')
    .replace(/<ol>(?![\s\S]*?<\/ol>)/gi, '<ol></ol>')
    // rimuovi <li> vuoti
    .replace(/<li[^>]*>\s*<\/li>/gi, '')
    // unisci SOLO liste consecutive dello stesso tipo
    .replace(/<\/ul>\s*<ul[^>]*>/gi, '')
    .replace(/<\/ol>\s*<ol[^>]*>/gi, '')
    .trim();
}




function parseSceneBlocks(html) {
  const inner = extractPageContent(html)
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n');
  const blocks = [];
  const re = /<(div|p)[^>]*class="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(inner))) {
    const classList = m[2].split(/\s+/);
    const raw = decodeEntities(stripTags(m[3])).trimEnd();
    const known = ['scene-heading', 'character', 'dialogue', 'parenthetical', 'transition', 'action', 'scene-gap'];
    const type = classList.find(c => known.includes(c)) || 'action';
    if (type === 'scene-gap') { blocks.push({ type: 'scene-gap', text: '' }); continue; }
    const text = (raw || '').trim();
    if (!text && type !== 'scene-gap') continue;
    blocks.push({ type, text });
  }
  return blocks;
}

function renderSceneBlocks(doc, html) {
    // --- FIX PDF: reinserisce righe vuote tra i blocchi scena (scene-gap) ---
  if (html && typeof html === 'string') {
    html = html.replace(/<\/div>\s*(?=<div)/g, '</div><div class="scene-gap"></div>');
  }

  const blocks = parseSceneBlocks(html);
  const base = 12;
  doc.font('Mono').fontSize(base);
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rel = { character: 300 / 700, dialogue: 400 / 700, parenthetical: 360 / 700 };
  const center = (w) => left + (width - w) / 2;

  for (const b of blocks) {
    switch (b.type) {
      case 'scene-heading':
        doc.font('Mono-Bold')
          .text(b.text.toUpperCase(), left, undefined, { width, align: 'left' })
          .moveDown(0.4)
          .font('Mono');
        break;
      case 'character': {
        const w = width * rel.character;
        doc.font('Mono-Bold')
          .text(b.text.toUpperCase(), center(w), undefined, { width: w, align: 'center' })
          .moveDown(0.2)
          .font('Mono');
        break;
      }
      case 'dialogue': {
        const w = width * rel.dialogue;
        doc.text(b.text, center(w), undefined, { width: w, align: 'left' }).moveDown(0.2);
        break;
      }
      case 'parenthetical': {
        const w = width * rel.parenthetical;
        doc.font('Mono-Oblique')
          .text(`(${b.text})`, center(w), undefined, { width: w, align: 'left' })
          .moveDown(0.2)
          .font('Mono');
        break;
      }
      case 'transition':
        doc.font('Mono-Bold')
          .text(b.text.toUpperCase(), left, undefined, { width, align: 'right' })
          .moveDown(0.2)
          .font('Mono');
        break;
      case 'scene-gap':
        doc.moveDown(0.8);
        break;
      default:
        doc.text(b.text, left, undefined, { width, align: 'left' }).moveDown(0.2);
    }
  }
}
/* ======================================================================
   RICH TEXT CLASSIC (Lora, liste, heading, inline)
   ====================================================================== */
const PX2PT = 0.75;
const BASE_PX = 16;

function fontPt(px) { return Math.round(px * PX2PT * 100) / 100; }
function fontSizePx(n) {
  const N = Number(n);
  if (N === 2) return 14;
  if (N === 3) return 16;
  if (N === 4) return 18;
  return 16 + 2 * (N - 3);
}

function inlineSegments(html) {
  let s = String(html || '');
  s = s
    .replace(/<(strong|b)>/gi, '[[B_ON]]')
    .replace(/<\/(strong|b)>/gi, '[[B_OFF]]')
    .replace(/<(em|i)>/gi, '[[I_ON]]')
    .replace(/<\/(em|i)>/gi, '[[I_OFF]]')
    .replace(/<u>/gi, '[[U_ON]]')
    .replace(/<\/u>/gi, '[[U_OFF]]')
    .replace(/<font[^>]*size=["']?([1-7])["']?[^>]*>/gi, (_, n) => `[[SIZE_ON:${n}]]`)
    .replace(/<\/font>/gi, '[[SIZE_OFF]]')
    .replace(/<br\s*\/?>/gi, '\n');

  s = stripTags(s);
  s = decodeEntities(s);
  const parts = s.split(/(\[\[B_ON\]\]|\[\[B_OFF\]\]|\[\[I_ON\]\]|\[\[I_OFF\]\]|\[\[U_ON\]\]|\[\[U_OFF\]\]|\[\[SIZE_ON:\d\]\]|\[\[SIZE_OFF\]\])/);

  const segs = [];
  let st = { b: false, i: false, u: false };
  const stack = [];
  let curPx = BASE_PX;

  for (const p of parts) {
    if (!p) continue;
    if (p === '[[B_ON]]') { st.b = true; continue; }
    if (p === '[[B_OFF]]') { st.b = false; continue; }
    if (p === '[[I_ON]]') { st.i = true; continue; }
    if (p === '[[I_OFF]]') { st.i = false; continue; }
    if (p === '[[U_ON]]') { st.u = true; continue; }
    if (p === '[[U_OFF]]') { st.u = false; continue; }
    if (p.startsWith('[[SIZE_ON:')) { stack.push(curPx); curPx = fontSizePx(p.match(/\d/)[0]); continue; }
    if (p === '[[SIZE_OFF]]') { curPx = stack.pop() || BASE_PX; continue; }
    segs.push({ text: p, b: st.b, i: st.i, u: st.u, sizePt: fontPt(curPx) });
  }
  return segs;
}

function fontFor(seg, prefix) {
  if (prefix === 'Mono') {
    if (seg.b && seg.i) return 'Mono-BoldOblique';
    if (seg.b) return 'Mono-Bold';
    if (seg.i) return 'Mono-Oblique';
    return 'Mono';
  }
  if (seg.b && seg.i) return 'Serif-BoldItalic';
  if (seg.b) return 'Serif-Bold';
  if (seg.i) return 'Serif-Italic';
  return 'Serif';
}

function lineGapFromSegs(segs) {
  const m = Math.max(...segs.map(s => s.sizePt || fontPt(BASE_PX)), fontPt(BASE_PX));
  return Math.round(m * 0.25 * 100) / 100;
}

function drawSegs(doc, segs, { x, width, fontPrefix }) {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    doc.font(fontFor(s, fontPrefix))
      .fontSize(s.sizePt)
      .text(s.text, x, undefined, {
        width,
        align: 'left',
        continued: i < segs.length - 1,
        underline: s.u
      });
  }
  doc.text('', { continued: false });
}




function renderList(doc, html, { isOL = false, depth = 0, left, width, fontPrefix }) {
  const indent = 28;
  const li = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let idx = 0;
  let match;

  while ((match = li.exec(html))) {
    idx++;
    const inner = match[1] || '';

    // Determina il simbolo: numero se lista ordinata, punto se non ordinata
    const marker = isOL ? `${idx}.` : '•';

    // Rileva eventuali sottoliste
    const subRe = /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
    const subs = [...inner.matchAll(subRe)];
    const textPart = inner.replace(subRe, '').trim();

    const segs = inlineSegments(textPart);
    const gap = lineGapFromSegs(segs);

    const xStart = left + indent * depth;
    const markerText = marker + ' ';
    const markerWidth = doc.widthOfString(markerText) + 6;
    const xText = xStart + markerWidth;
    const avail = width - (xText - left);

    // Disegna il marker (numero o bullet)
    doc.font(`${fontPrefix}-Bold`).fontSize(12)
       .text(markerText, xStart, undefined, { continued: true });

    drawSegs(doc, segs, { x: xText, width: avail, fontPrefix });
    doc.text('', { continued: false });
    doc.moveDown(0.25);

    // Gestione sottoliste
    for (const sub of subs) {
      renderList(doc, sub[2], {
        isOL: sub[1] === 'ol',
        depth: depth + 1,
        left,
        width,
        fontPrefix
      });
    }
  }
}





/* ---------- Pagina Rich Text ---------- */
function renderRichTextPage(doc, html, fontPrefix = 'Serif') {
  if (!html || typeof html !== 'string') return;

   // 🔹 Pulisce liste corrotte prima del parsing
  html = fixBrokenLists(html);
 

  const inner = extractPageContent(html)
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n');

  // Normalizza liste annidate o frammentate
  const cleanLists = inner
    .replace(/<\/(ul|ol)>\s*<\1>/gi, '')     // unisci liste consecutive
    .replace(/<(ul|ol)><\1>/gi, '<$1>')      // doppie aperture
    .replace(/<\/(ul|ol)><\/\1>/gi, '</$1>') // doppie chiusure
    .replace(/<li[^>]*>\s*<\/li>/gi, '');    // elimina li vuoti

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

// 🔹 Separa i blocchi principali (fix definitivo: conserva tipo ul/ol anche con newline o testo)
const blocks = [];
const re = /<(h[1-3]|p|div|ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
let lastIndex = 0;
let match;

while ((match = re.exec(cleanLists))) {
  const before = cleanLists.slice(lastIndex, match.index).trim();
  if (before) blocks.push({ type: 'div', html: before });

  // ✅ fix: se inner contiene liste annidate, non sovrascrivere il tipo
  const tag = (match[1] || 'div').toLowerCase();
  const inner = (match[2] || '').trim();

  // 🔹 nuovo fix — se inner contiene <ol>, forziamo type=ol; se <ul>, forziamo type=ul
  const forcedType = /<\s*ol\b/i.test(inner)
    ? 'ol'
    : /<\s*ul\b/i.test(inner)
    ? 'ul'
    : tag;

  blocks.push({ type: forcedType, html: inner });
  lastIndex = re.lastIndex;
}

const after = cleanLists.slice(lastIndex).trim();
if (after) blocks.push({ type: 'div', html: after });


  // Rendering dei blocchi (ora include testo fuori lista)
  for (const b of blocks) {
    const htmlBlock = (b.html || '').trim();

// 🔹 Liste numerate e puntate — conversione esplicita (PDF-safe)
if (b.type === 'ol' || b.type === 'ul') {
  let items = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match, idx = 0;
  while ((match = liRegex.exec(b.html))) {
    const safeItem = decodeEntities(stripTags(match[1] || '')).trim();
    if (!safeItem) continue;
    idx++;
    if (b.type === 'ol') items.push(`${idx}. ${safeItem}`);
    else items.push(`• ${safeItem}`);
  }
  // Ricrea il blocco testuale numerato/puntato
  const listText = items.join('\n');
  const segs = inlineSegments(listText);
  drawSegs(doc, segs, { x: left, width, fontPrefix });
  doc.moveDown(0.6);
  continue;
}

// Se blocco vuoto, salta
if (!htmlBlock) continue;

// Titoli (h1..h3)
if (['h1', 'h2', 'h3'].includes(b.type)) {
  const size =
    b.type === 'h1' ? fontPt(32) :
    b.type === 'h2' ? fontPt(24) : fontPt(18);
  doc.font(`${fontPrefix}-Bold`)
     .fontSize(size)
     .text(stripTags(decodeEntities(htmlBlock)), left, undefined, {
       width,
       align: 'left'
     });
  doc.moveDown(0.8);
  doc.font(fontPrefix).fontSize(fontPt(BASE_PX));
  continue;
}

// 🔹 Liste vere (<ul> / <ol>) o annidate (solo fallback per annidate)
const hasUL = /<ul[^>]*>/.test(htmlBlock);
const hasOL = /<ol[^>]*>/.test(htmlBlock);
if (hasUL || hasOL) {
  renderList(doc, htmlBlock, { isOL: hasOL, depth: 0, left, width, fontPrefix });
  doc.moveDown(0.4);
  continue;
}

// 🔹 Testo semplice o fuori lista
const segs = inlineSegments(htmlBlock);
drawSegs(doc, segs, { x: left, width, fontPrefix });
doc.moveDown(0.6);

  }


}

/* ---------- Gestione pagine multiple ---------- */
function renderRichTextPages(doc, rawHtml, fontPrefix = 'Serif') {
  if (!rawHtml) return;
  const pages = [];
  const re = /<div[^>]*class="[^"]*page-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(rawHtml))) pages.push(m[1]);
  if (!pages.length) pages.push(extractPageContent(rawHtml));

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) doc.addPage();
    renderRichTextPage(doc, pages[i], fontPrefix);
  }
}


/* ======================================================================
   JSON SECTION FORMATTERS (con protezione campi undefined)
   ====================================================================== */

// 🔹 Safe getter per evitare errori se un campo è undefined o non stringa
function safe(v) {
  return (typeof v === 'string') ? v : '';
}

function formatCharactersJSON(raw, L) {
  let arr = [];
  try { arr = JSON.parse(raw); } catch { return ''; }
  if (!Array.isArray(arr) || !arr.length) return '';
  const f = L.fields;
  const lines = [];
  arr.forEach((ch, i) => {
    lines.push(`\n=== ${f.characterHeader} ${i + 1} ===`);
    if (ch.name) lines.push(`${f.name}: ${safe(ch.name)}`);
    if (ch.role) lines.push(`${f.role}: ${safe(ch.role)}`);
    if (ch.ageAppearance) lines.push(`${f.ageAppearance}: ${safe(ch.ageAppearance)}`);
    if (ch.background) lines.push(`${f.background}:\n${safe(ch.background)}`);
    if (ch.goal) lines.push(`${f.goal}:\n${safe(ch.goal)}`);
    if (ch.conflict) lines.push(`${f.conflict}:\n${safe(ch.conflict)}`);
    if (ch.arc) lines.push(`${f.arc}:\n${safe(ch.arc)}`);
    if (ch.relationships) lines.push(`${f.relationships}:\n${safe(ch.relationships)}`);
    if (ch.traits) lines.push(`${f.traits}:\n${safe(ch.traits)}`);
    if (ch.quote) lines.push(`${f.quote}: ${safe(ch.quote)}`);
    if (ch.notes) lines.push(`${f.notes}:\n${safe(ch.notes)}`);
    if (Array.isArray(ch.customFields)) {
      ch.customFields.forEach(cf => {
        const t = safe(cf?.title || f.custom).toUpperCase();
        const v = safe(cf?.value || '');
        if (v.trim()) lines.push(`${t}:\n${v}`);
      });
    }
  });
  return lines.join('\n');
}

function formatBibleJSON(raw, L) {
  let arr = [];
  try { arr = JSON.parse(raw); } catch { return ''; }
  if (!Array.isArray(arr) || !arr.length) return '';

  const f = L.fields; // stessa logica delle altre sezioni
  const lines = [];

  arr.forEach(sec => {
    const title = safe(sec?.title || '').toUpperCase().trim();
    const content = safe(sec?.content || '').trim();
    if (!title && !content) return;

    // usa la parola "Sezione" o "Section" dalla lingua corrente
    lines.push(`\n=== ${title || f.section.toUpperCase()} ===`);
    if (content) lines.push(content);
  });

  return lines.join('\n');
}




function formatTimelineJSON(raw, L) {
  let arr = [];
  try { arr = JSON.parse(raw); } catch { return ''; }
  if (!Array.isArray(arr) || !arr.length) return '';
  arr.sort((a,b) =>
    (a?.ordering ?? 0) - (b?.ordering ?? 0) ||
    (a?.stackPos ?? 0) - (b?.stackPos ?? 0)
  );
  const label = (DEFAULT_LABELS[L.lang]?.fields.timelineEvent || L.fields.timelineEvent);
  const lines = [];
  arr.forEach((ev, i) => {
    const title = safe(ev?.title || '').trim();
    const desc = safe(ev?.desc || '').trim();
    lines.push(`\n— ${label} ${i + 1}${title ? `: ${title}` : ''}`);
    if (desc) lines.push(desc);
  });
  return lines.join('\n');
}

function formatBibleJSON(raw, L) {
  let arr = [];
  try { arr = JSON.parse(raw); } catch { return ''; }
  if (!Array.isArray(arr) || !arr.length) return '';

  // 🔹 Determina la lingua effettiva
  let lang = (L?.lang || '').toLowerCase();
  if (!lang || !['it', 'en'].includes(lang)) {
    try {
      const prefPath = path.join(__dirname, '../..', 'data', 'preferences.json');
      if (fs.existsSync(prefPath)) {
        const json = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
        lang = (json.language || 'it').toLowerCase().startsWith('en') ? 'en' : 'it';
      } else lang = 'it';
    } catch { lang = 'it'; }
  } else {
    lang = lang.startsWith('en') ? 'en' : 'it';
  }

  const LDICT = DEFAULT_LABELS[lang]; // etichette principali
  let bibleLabels = {};

  // 🔹 Carica traduzioni della Bibbia dal file locale (es. ./frontend/locales/en.json)
  try {
    const localesPath = path.join(__dirname, '../../frontend/locales', `${lang}.json`);
    if (fs.existsSync(localesPath)) {
      const json = JSON.parse(fs.readFileSync(localesPath, 'utf8'));
      bibleLabels = json?.editor?.bible || {};
    }
  } catch {
    bibleLabels = {};
  }

  const lines = [];
  arr.forEach(sec => {
    let title = safe(sec?.title || '').trim();
    const content = safe(sec?.content || '').trim();
    if (!title && !content) return;

    // 🔹 Confronta con le chiavi note della Bibbia (case-insensitive)
    const key = Object.keys(bibleLabels).find(
      k => k.toLowerCase() === title.toLowerCase() || bibleLabels[k].toLowerCase() === title.toLowerCase()
    );

    if (key) {
      title = bibleLabels[key]; // traduzione dal file di lingua
    }

    lines.push(`\n=== ${title.toUpperCase()} ===`);
    if (content) lines.push(content);
  });

  return lines.join('\n');
}



function formatBeatsJSON(raw, L) {
  let arr = [];
  try { arr = JSON.parse(raw); } catch { return ''; }
  if (!Array.isArray(arr) || !arr.length) return '';

  const f = L.fields;
  const lines = [];

  arr.forEach((beat, i) => {
    const title = safe(beat?.title || '').trim();
    const summary = safe(beat?.summary || '').trim();
    const objective = safe(beat?.objective || '').trim();
    const obstacle = safe(beat?.obstacle || '').trim();
    const outcome = safe(beat?.outcome || '').trim();
    const timePlace = safe(beat?.timePlace || '').trim();
    const characters = safe(beat?.characters || '').trim();
    const container = safe(beat?.container || '').trim();
    const links = safe(beat?.links || '').trim();

    lines.push(`\n=== ${f.beatHeader} ${i + 1} ===`);
    if (title)       lines.push(`${f.title}: ${title}`);
    if (container)   lines.push(`${f.container}: ${container}`);
    if (summary)     lines.push(`${f.summary}:\n${summary}`);
    if (objective)   lines.push(`${f.objective}: ${objective}`);
    if (obstacle)    lines.push(`${f.obstacle}: ${obstacle}`);
    if (outcome)     lines.push(`${f.outcome}: ${outcome}`);
    if (timePlace)   lines.push(`${f.timePlace}: ${timePlace}`);
    if (characters)  lines.push(`${f.characters}: ${characters}`);
    if (links)       lines.push(`${f.links}: ${links}`);

    if (Array.isArray(beat.customFields)) {
      beat.customFields.forEach(cf => {
        const t = safe(cf?.title || f.custom).toUpperCase();
        const v = safe(cf?.value || '').trim();
        if (v) lines.push(`${t}:\n${v}`);
      });
    }
  });

  return lines.join('\n');
}



function jsonSectionToText(sectionId, raw, L) {
  if (sectionId === 'personaggi') return formatCharactersJSON(raw, L);
  if (sectionId === 'scaletta')   return formatBeatsJSON(raw, L);
  if (sectionId === 'timeline')   return formatTimelineJSON(raw, L);
  if (sectionId === 'bibbia')     return formatBibleJSON(raw, L);
  return '';
}


/* ======================================================================
   TIMELINE COLORED BARS (invariato)
   ====================================================================== */
const TIMELINE_COLORS = {
  red:'#ff5252', blue:'#4dabff', green:'#4caf50', yellow:'#ffca28',
  purple:'#9c27b0', white:'#e0e0e0', black:'#424242', orange:'#ff9800'
};

function renderTimelineColored(doc, raw, L) {
  let arr = [];
  try { arr = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(arr) || !arr.length) return;

  const label = L.lang === 'en' ? 'Event' : 'Evento';

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // 🔹 Genera numerazione gerarchica (1, 2.1, 2.2, ecc.)
  const grouped = {};
  arr.forEach(ev => {
    const ord = ev.ordering ?? 0;
    if (!grouped[ord]) grouped[ord] = [];
    grouped[ord].push(ev);
  });

  const keys = Object.keys(grouped).map(Number).sort((a,b)=>a-b);
  let mainCount = 0;

  keys.forEach(ord => {
    mainCount++;
    const group = grouped[ord].sort((a,b)=>(a.stackPos??0)-(b.stackPos??0));

    // gruppo singolo → 1, 2, 3...
    if (group.length === 1) {
      const ev = group[0];
      const colorHex = TIMELINE_COLORS[ev?.colorId] || null;
      if (colorHex) {
        const yBar = doc.y + 2;
        doc.save().fillColor(colorHex).rect(x, yBar, w, 6).fill().restore();
        doc.moveDown(0.5);
      }
      const num = `${mainCount}.`;
      const title = (ev.title || '').trim();
      const header = `${num} ${title || `${label} ${mainCount}`}`;
      doc.font('Mono-Bold').fontSize(13).fillColor('#111')
         .text(header, x, undefined, { width:w, align:'left' });
      if (ev.desc?.trim()) {
        doc.font('Mono').fontSize(12).fillColor('#000')
           .text(ev.desc.trim(), x, undefined, { width:w, align:'left', lineGap:4 });
      }
      doc.moveDown(0.5);
    }
    // gruppo multiplo → 2.1, 2.2, ecc.
    else {
      group.forEach((ev, i) => {
        const colorHex = TIMELINE_COLORS[ev?.colorId] || null;
        if (colorHex) {
          const yBar = doc.y + 2;
          doc.save().fillColor(colorHex).rect(x, yBar, w, 6).fill().restore();
          doc.moveDown(0.5);
        }
        const num = `${mainCount}.${i+1}`;
        const title = (ev.title || '').trim();
        const header = `${num} ${title || `${label} ${num}`}`;
        doc.font('Mono-Bold').fontSize(13).fillColor('#111')
           .text(header, x, undefined, { width:w, align:'left' });
        if (ev.desc?.trim()) {
          doc.font('Mono').fontSize(12).fillColor('#000')
             .text(ev.desc.trim(), x, undefined, { width:w, align:'left', lineGap:4 });
        }
        doc.moveDown(0.5);
      });
    }

    const y = doc.y + 4;
    doc.save().lineWidth(0.7).strokeColor('#E5E7EB').moveTo(x,y).lineTo(x+w,y).stroke().restore();
    doc.moveDown(0.6);
  });
}

/* ======================================================================
   EXPORT FUNCTIONS (Project + Section)
   ====================================================================== */
async function exportProject(projectName, sections, format = 'pdf', exportPath = null, labels = null) {
  if (format !== 'pdf') throw new Error('Formato non supportato.');

  const L = mergeLabels(labels);
  if (!L.projectType) {
    try {
      const detectedType = await projectManager.getProjectType(projectName);
      applyProjectTypeOverrides(L, detectedType);
    } catch {
      // ignore missing project type
    }
  }
  const projectPath = projectManager.getProjectPath(projectName);
  const defaultPath = path.join(projectPath, `export_${projectName}.${format}`);
  const outPath = exportPath || defaultPath;

  await fs.ensureDir(path.dirname(outPath));
  const doc = new PDFDocument({
    size: [675, 841.5],
    margins: { top: 54, bottom: 54, left: 66, right: 66 },
    autoFirstPage: false,
    bufferPages: true
  });

  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  applyPdfInfo(doc, { title: projectName, subject: 'Scriptum Export' });
  registerFonts(doc);

  const contentWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  let wroteAnything = false;

  for (const section of sections) {
    const filePath = path.join(projectPath, `${section}.txt`);
    if (!(await fs.pathExists(filePath))) continue;

    const raw = await fs.readFile(filePath, 'utf-8');
    const looksJson = /^\s*[\[{]/.test(raw);
    const isScene = section === 'scene';

    if (!isScene && !looksJson && !htmlToPlainText(raw).trim()) continue;

    doc.addPage();

    doc.font('Mono-Bold').fontSize(18)
       .text(sectionLabel(section, L), doc.page.margins.left, undefined,
             { width: contentWidth(), align: 'center' });
    doc.moveDown(0.8);
    doc.font('Mono').fontSize(12);

    if (isScene) {
      renderSceneBlocks(doc, raw);
    } else if (looksJson && section === 'timeline') {
      renderTimelineColored(doc, raw, L);
    } else if (looksJson && ['personaggi', 'scaletta', 'bibbia'].includes(section)) {
      const text = jsonSectionToText(section, raw, L);
      if (text.trim()) {
        doc.text(text, doc.page.margins.left, undefined, {
          width: contentWidth(),
          align: 'left',
          lineGap: 4
        });
      }
    } else {
      renderRichTextPages(doc, raw, 'Serif');
    }
    wroteAnything = true;
  }

  if (!wroteAnything) {
    doc.addPage();
    doc.font('Mono').fontSize(14)
       .text(L.lang === 'en' ? 'No content to export.' : 'Nessun contenuto da esportare.',
             doc.page.margins.left, undefined, { width: contentWidth(), align: 'left' });
  }

  numberAllPages(doc, L);
  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

/* ===========================================================
   Export: Single Section -> PDF
   =========================================================== */
async function exportSectionPDF(projectName, sectionName, exportPath = null, labels = null) {
  const L = mergeLabels(labels);
  if (!L.projectType) {
    try {
      const detectedType = await projectManager.getProjectType(projectName);
      applyProjectTypeOverrides(L, detectedType);
    } catch {
      // ignore missing project type
    }
  }
  const projectPath = projectManager.getProjectPath(projectName);
  const sectionPath = path.join(projectPath, `${sectionName}.txt`);
  if (!(await fs.pathExists(sectionPath))) throw new Error(`La sezione "${sectionName}" non esiste.`);

  const raw = await fs.readFile(sectionPath, 'utf-8');
  const looksJson = /^\s*[\[{]/.test(raw);
  const isScene = sectionName === 'scene';
  const projectDefault = path.join(projectPath, `${sectionName}_export.pdf`);
  const outPath = exportPath || projectDefault;

  await fs.ensureDir(path.dirname(outPath));
  const doc = new PDFDocument({
    size: [675, 841.5],
    margins: { top: 54, bottom: 54, left: 66, right: 66 },
    autoFirstPage: false,
    bufferPages: true
  });

  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  applyPdfInfo(doc, {
    title: `${projectName} — ${sectionLabel(sectionName, L)}`,
    subject: 'Scriptum Export (Section)'
  });

  registerFonts(doc);

  const contentWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.addPage();

  doc.font('Mono-Bold').fontSize(18)
     .text(sectionLabel(sectionName, L), doc.page.margins.left, undefined,
           { width: contentWidth(), align: 'center' });
  doc.moveDown(0.8);
  doc.font('Mono').fontSize(12);

  if (isScene) {
    renderSceneBlocks(doc, raw);
  } else if (looksJson && sectionName === 'timeline') {
    renderTimelineColored(doc, raw, L);
  } else if (looksJson && ['personaggi', 'scaletta', 'bibbia'].includes(sectionName)) {
    const text = jsonSectionToText(sectionName, raw, L);
    if (text.trim()) {
      doc.text(text, doc.page.margins.left, undefined, { width: contentWidth(), align: 'left', lineGap: 4 });
    }
  } else {
    renderRichTextPages(doc, raw, 'Serif');
  }

  numberAllPages(doc, L);
  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

/* ===========================================================
   EXPORT MODULE
   =========================================================== */
module.exports = {
  exportProject,
  exportSectionPDF
};
