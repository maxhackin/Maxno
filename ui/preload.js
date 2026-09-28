const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close: () => ipcRenderer.send('close-window'),
  forceQuit: () => ipcRenderer.send('force-quit'),
  readyToShow: () => ipcRenderer.send('renderer-ready-to-show'),
  setAlwaysOnTop: (topmost) => ipcRenderer.send('set-always-on-top', topmost),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  fetchChangelogs: () => ipcRenderer.invoke('fetch-changelogs'),
  scriptbloxFetch: (endpoint, query) => ipcRenderer.invoke('scriptblox-fetch', { endpoint, query }),
  setWindowSize: (width, height) => ipcRenderer.invoke('set-window-size', width, height),
  setWindowResizable: (enabled) => ipcRenderer.send('set-window-resizable', !!enabled),
  getWindowResizable: async () => {
    try { return await ipcRenderer.invoke('get-window-resizable'); } catch (e) { return false; }
  },
  onMaximizeChange: (callback) => ipcRenderer.on('maximize-change', callback),
  openAutoexecDir: () => ipcRenderer.invoke('open-autoexec-dir'),
  openWorkspaceDir: () => ipcRenderer.invoke('open-workspace-dir'),
  readLocalFile: async (filePath) => {
    try { return await ipcRenderer.invoke('read-local-file', filePath); } catch (e) { return { ok: false, error: String(e) }; }
  },
  pickLocalFile: async () => {
    try { return await ipcRenderer.invoke('pick-local-file'); } catch (e) { return { ok: false, error: String(e) }; }
  },
  xenoVersion: async () => {
    try { return await ipcRenderer.invoke('xeno-version'); } catch (e) { return ''; }
  },
  xenoGetClients: async () => {
    try { return await ipcRenderer.invoke('xeno-get-clients'); } catch (e) { return []; }
  },
  xenoAttach: async () => {
    try { return await ipcRenderer.invoke('xeno-attach'); } catch (e) { return { ok: false }; }
  },
  xenoSetSetting: async (settingType, val) => {
    try { return await ipcRenderer.invoke('xeno-set-setting', settingType, val); } catch (e) { return { ok: false }; }
  },
  xenoKillRoblox: async () => {
    try { return await ipcRenderer.invoke('xeno-kill-roblox'); } catch (e) { return { ok: false }; }
  },
  xenoKillRobloxPid: async (pid) => {
    try { return await ipcRenderer.invoke('xeno-kill-roblox-pid', pid); } catch (e) { return { ok: false, killed: false }; }
  },
  setTaskbarStatus: (status) => ipcRenderer.send('taskbar-status', status),
  setMinimizeToTray: (enabled) => ipcRenderer.send('set-minimize-to-tray', !!enabled),
  getDebugConsole: async () => {
    try { return await ipcRenderer.invoke('get-debug-console'); } catch (e) { return false; }
  },
  setDebugConsole: (enabled) => ipcRenderer.send('set-debug-console', !!enabled),
  restartApp: () => ipcRenderer.send('restart-app'),
  onXenoClients: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => {
      try { callback(Array.isArray(data) ? data : []); } catch (_) {}
    };
    ipcRenderer.on('xeno-clients', listener);
    return () => {
      try { ipcRenderer.removeListener('xeno-clients', listener); } catch (_) {}
    };
  }
});