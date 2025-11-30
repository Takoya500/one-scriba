// src/backend/preload.js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** API lingua, come prima ma con sanitizzazione */
const api = Object.freeze({
  getLanguage: () => ipcRenderer.invoke('get-language'),
  setLanguage: (lang) => {
    const v = String(lang || '').toLowerCase();
    const safe = (v === 'it' || v === 'en') ? v : 'it';
    return ipcRenderer.invoke('set-language', safe);
  }
});

/** Bridge minimale e sicuro verso ipcRenderer */
const electronBridge = Object.freeze({
  ipcRenderer: Object.freeze({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send:   (channel, ...args) => ipcRenderer.send(channel, ...args),

    // Nasconde l'oggetto event al renderer
on: (channel, listener) => {
  const wrapped = (_event, ...args) => {
    try {
      // Se non ci sono argomenti, passa un oggetto vuoto
      if (!args || args.length === 0) listener({});
      else listener(...args);
    } catch (err) {
      if (!String(err).includes("Cannot destructure property 'factor'")) {
  console.warn(`[preload] errore listener "${channel}":`, err);
}

    }
  };
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
},

    once: (channel, listener) =>
      ipcRenderer.once(channel, (_event, ...a) => listener(...a)),

    removeListener: (channel, listener) =>
      ipcRenderer.removeListener(channel, listener),
    removeAllListeners: (channel) =>
      ipcRenderer.removeAllListeners(channel),
  })
});

try {
  if (process.contextIsolated && contextBridge?.exposeInMainWorld) {
    // ✅ Caso consigliato: contextIsolation: true
    contextBridge.exposeInMainWorld('electron', electronBridge);
    contextBridge.exposeInMainWorld('api', api);
  } else {
    // Fallback: contextIsolation: false → attacca direttamente a window
    // (il preload condivide il contesto del renderer)
    window.electron = electronBridge;
    window.api = api;
  }
} catch (err) {
  // Estremo fallback
  try {
    window.electron = electronBridge;
    window.api = api;
  } catch (_) {}
}
