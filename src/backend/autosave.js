// backend/autosave.js
// Gestione salvataggio contenuti sezioni
const fs = require('fs-extra');
const path = require('path');
const projectManager = require('./projectManager');

// Salvataggio universale (per ogni progetto e sezione)
async function saveContent(content, projectName, sectionName) {
  try {
    // Percorso del progetto
    const projectPath = projectManager.getProjectPath(projectName);
    if (!projectPath) throw new Error(`Percorso non trovato per il progetto: ${projectName}`);

    // File della sezione (es: concept.txt)
    const sectionPath = path.join(projectPath, `${sectionName}.txt`);

    // Scrittura su disco
    await fs.outputFile(sectionPath, content, 'utf8');
    return true;
  } catch (err) {
    console.error(`Errore nel salvataggio di [${projectName} | ${sectionName}]:`, err);
    throw err;
  }
}

module.exports = { saveContent };
