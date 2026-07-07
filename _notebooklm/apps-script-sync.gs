/**
 * Sync NortexVault/_notebooklm/*.md (GitHub) → Google Docs → NotebookLM
 * ---------------------------------------------------------------------
 * Cadena completa:
 *   vault local → obsidian-git push → GitHub → este script (cada hora)
 *   → Google Docs → NotebookLM auto-sync (nativo desde mayo 2026)
 *
 * INSTALACIÓN (una sola vez, ~5 min):
 * 1. Ir a https://script.google.com → Nuevo proyecto → pegar este archivo.
 * 2. GitHub → Settings → Developer settings → Fine-grained tokens →
 *    crear token de SOLO LECTURA (Contents: Read-only) para el repo
 *    Noahstark23/NortexVault.
 * 3. En Apps Script: Configuración del proyecto (engranaje) →
 *    Propiedades del script → agregar propiedad:
 *      GITHUB_TOKEN = <tu token>
 * 4. Ejecutar la función instalarTrigger() una vez (autorizar permisos).
 * 5. Listo. Corre cada hora. Ver ejecuciones en el menú "Ejecuciones".
 */

const REPO = 'Noahstark23/NortexVault';
const BRANCH = 'main';

// archivo en _notebooklm/  →  ID del Google Doc (carpeta NortexVault-NotebookLM)
const FILES = {
  'proyecto-kalshi-bot.md':    '1h5RUtj81uVux8LPcXJ85hnfxRK9sfyJIV-c2dRD637c',
  'proyecto-nortex.md':        '1EJULLwuS_3o28ZDBAB0nMcq6yzQRGGoYBRbLwzjaAlQ',
  'proyecto-psicoisabel.md':   '1ZyQTV_Jn8-5AcyzXAiOvtVDrjrlri36-5FeN955oEw0',
  'proyecto-esteli-build.md':  '1lU6UvZHiGlntIEcW8Fh6mq6gNh1s7uzJyjVOR0leWZ8',
  'proyecto-youtube-latam.md': '1B_oPRJHNEpp_NpVj1YKPSrEw-FUbWT-SEuN4CuDMAbQ',
  'area-finanzas.md':          '1B2sqMgb7xJCs2UY10Cp2iAnLSvOdqAdBvJUtJ7NtSMk',
  'area-trading.md':           '19wwWhIFnaMy9zzRXf2yYGJ2RLnCzdPgTvm-ISCVDgSk',
  'area-salud.md':             '1YKmOQQBLUCkR3x4ht3badkvBDgNIwtWlgWUYH__GeE8',
  'area-ciberseguridad.md':    '1OA8hF5BydEl12uzCyeuQycH_L58_7oCFhboFGidvFN0',
};

function syncNotebookLM() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Falta GITHUB_TOKEN en Propiedades del script.');

  for (const [file, docId] of Object.entries(FILES)) {
    try {
      const url = 'https://api.github.com/repos/' + REPO +
        '/contents/_notebooklm/' + encodeURIComponent(file) + '?ref=' + BRANCH;
      const res = UrlFetchApp.fetch(url, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) {
        console.warn(file + ': HTTP ' + res.getResponseCode());
        continue;
      }
      const json = JSON.parse(res.getContentText());

      // Solo reescribir el Doc si el archivo cambió en GitHub (compara SHA)
      if (props.getProperty('sha_' + file) === json.sha) continue;

      const content = Utilities.newBlob(
        Utilities.base64Decode(json.content.replace(/\s/g, ''))
      ).getDataAsString('UTF-8');

      const doc = DocumentApp.openById(docId);
      const body = doc.getBody();
      body.clear();
      body.setText(content);
      doc.saveAndClose();

      props.setProperty('sha_' + file, json.sha);
      console.log(file + ' → actualizado (' + content.length + ' chars)');
    } catch (e) {
      console.error(file + ': ' + e.message);
    }
  }
}

/** Ejecutar UNA vez para crear el trigger horario. */
function instalarTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncNotebookLM') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNotebookLM').timeBased().everyHours(1).create();
  syncNotebookLM(); // primer sync inmediato
}
