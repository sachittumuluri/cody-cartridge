const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("musicHost", {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  importAudioPaths: (filePaths) => ipcRenderer.invoke("music:import-audio-paths", filePaths),
  loadDefaultLibrary: () => ipcRenderer.invoke("music:load-default-library"),
  onMenuCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("app-menu:command", listener);
    return () => ipcRenderer.removeListener("app-menu:command", listener);
  },
  pickAudioFiles: () => ipcRenderer.invoke("music:pick-audio-files"),
  pickAudioFolder: () => ipcRenderer.invoke("music:pick-audio-folder"),
  pickTakeoutCsv: () => ipcRenderer.invoke("music:pick-takeout-csv"),
  readTakeoutCsvPaths: (filePaths) => ipcRenderer.invoke("music:read-takeout-csv-paths", filePaths),
  setPlaybackActive: (active) => ipcRenderer.invoke("music:playback-active", Boolean(active))
});
