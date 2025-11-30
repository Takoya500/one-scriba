// i18n.js — mini motore i18n per renderer (IT/EN)
// Cartella dizionari: ./locales/<lang>.json

(() => {
  const state = {
    lang: 'it',
    dict: {},
    fallback: 'it',
  };

  function get(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
  }

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
  }

  async function loadDict(lang) {
    const url = `./locales/${lang}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Locale not found: ${lang}`);
    return res.json();
  }

  async function syncSpellChecker(lang) {
    try {
      const ipc = window.electron?.ipcRenderer;
      if (ipc?.invoke) await ipc.invoke('set-spell-lang', lang);
    } catch (err) {
      console.warn('[i18n] Spell checker sync failed:', err);
    }
  }

  async function setLang(lang) {
    try {
      state.dict = await loadDict(lang);
      state.lang = lang;
      localStorage.setItem('uiLang', lang);
      apply(document);
      await syncSpellChecker(lang);
    } catch (e) {
      console.warn('[i18n] Fallback to', state.fallback, e);
      if (lang !== state.fallback) {
        state.dict = await loadDict(state.fallback);
        state.lang = state.fallback;
        apply(document);
        await syncSpellChecker(state.fallback);
      }
    }
  }

  function t(key, params) {
    const v = get(state.dict, key);
    if (typeof v === 'string') return interpolate(v, params);
    // Fallback: mostra la chiave
    return key;
  }

  function apply(root = document) {
    // data-i18n per textContent
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
   // supporta sia "attr:key|attr2:key2" che "attr:key;attr2:key2"
   root.querySelectorAll('[data-i18n-attr]').forEach(el => {
   const spec = el.getAttribute('data-i18n-attr') || '';
   spec.split(/[|;]+/).forEach(pair => {
    const idx = pair.indexOf(':');
    if (idx === -1) return;
    const attr = pair.slice(0, idx).trim();
    const key  = pair.slice(idx + 1).trim();
    if (!attr || !key) return;
    el.setAttribute(attr, t(key));
   });
   });
   }

  // API globale
  window.I18N = {
    setLang,
    t,
    apply,
    get lang() { return state.lang; }
  };
})();
