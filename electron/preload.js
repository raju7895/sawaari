/* Preload for the desktop shell.
 * Exposes only what the renderer genuinely needs and nothing privileged. */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__SAWAARI_DESKTOP__', true);
contextBridge.exposeInMainWorld('sawaariDesktop', {
  platform: process.platform,
  version: process.versions.electron,
});
