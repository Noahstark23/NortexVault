/**
 * Sync NortexVault/_notebooklm/*.md (GitHub) -> Google Docs -> NotebookLM
 * ---------------------------------------------------------------------
 * ESTADO: INSTALADO Y OPERANDO desde 2026-07-07 en script.google.com
 * (cuenta noelpinedaa96@gmail.com, proyecto "NortexVault NotebookLM Sync",
 * trigger horario activo). Este archivo es la copia de referencia/backup.
 *
 * Cadena: vault local -> obsidian-git push -> GitHub -> este script (cada hora)
 * -> Google Docs (via Drive API) -> NotebookLM auto-sync (nativo desde mayo 2026).
 *
 * Sin GITHUB_TOKEN: lee raw.githubusercontent.com (funciona porque el repo es publico).
 * Con GITHUB_TOKEN (propiedad de script): usa la API de GitHub — NECESARIO si el
 * repo se hace privado (recomendado). Crear token fine-grained read-only del repo
 * y agregarlo en Configuracion del proyecto -> Propiedades del script.
 *
 * Requiere el servicio avanzado "Drive" (v3) habilitado (Servicios + -> Drive API).
 * NOTA: no usar DocumentApp.setText para docs grandes — tarda >6 min y el
 * timeout de Apps Script mata la ejecucion (leccion del primer intento).
 */

const REPO = 'Noahstark23/NortexVault';
const BRANCH = 'main';

// Orden: pequenos primero, kalshi (grande) al final.
const FILES = {
  'proyecto-nortex.md':        '1EJULLwuS_3o28ZDBAB0nMcq6yzQRGGoYBRbLwzjaAlQ',
  'proyecto-psicoisabel.md':   '1ZyQTV_Jn8-5AcyzXAiOvtVDrjrlri36-5FeN955oEw0',
  'proyecto-esteli-build.md':  '1lU6UvZHiGlntIEcW8Fh6mq6gNh1s7uzJyjVOR0leWZ8',
  'proyecto-youtube-latam.md': '1B_oPRJHNEpp_NpVj1YKPSrEw-FUbWT-SEuN4CuDMAbQ',
  'area-finanzas.md':          '1B2sqMgb7xJCs2UY10Cp2iAnLSvOdqAdBvJUtJ7NtSMk',
  'area-trading.md':           '19wwWhIFnaMy9zzRXf2yYGJ2RLnCzdPgTvm-ISCVDgSk',
  'area-salud.md':             '1YKmOQQBLUCkR3x4ht3badkvBDgNIwtWlgWUYH__GeE8',
  'area-ciberseguridad.md':    '1OA8hF5BydEl12uzCyeuQycH_L58_7oCFhboFGidvFN0',
  'proyecto-kalshi-bot.md':    '1h5RUtj81uVux8LPcXJ85hnfxRK9sfyJIV-c2dRD637c',
};

function syncNotebookLM() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN'); // opcional (repo publico)

  for (const [file, docId] of Object.entries(FILES)) {
    try {
      let content;
      if (token) {
        const url = 'https://api.github.com/repos/' + REPO +
          '/contents/_notebooklm/' + encodeURIComponent(file) + '?ref=' + BRANCH;
        const res = UrlFetchApp.fetch(url, {
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
          muteHttpExceptions: true,
        });
        if (res.getResponseCode() !== 200) { console.warn(file + ': HTTP ' + res.getResponseCode()); continue; }
        const json = JSON.parse(res.getContentText());
        content = Utilities.newBlob(
          Utilities.base64Decode(json.content.replace(/\s/g, ''))
        ).getDataAsString('UTF-8');
      } else {
        // raw.githubusercontent evita el rate-limit de la API anonima
        // (las IPs compartidas de Google agotan las 60 req/h de la API).
        const url = 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH +
          '/_notebooklm/' + encodeURIComponent(file);
        const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) { console.warn(file + ': HTTP ' + res.getResponseCode()); continue; }
        content = res.getContentText();
      }

      // Solo reescribir si el contenido cambio (hash MD5).
      const hash = Utilities.base64Encode(
        Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, content, Utilities