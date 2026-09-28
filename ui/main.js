const { app, BrowserWindow, Menu, ipcMain, shell, nativeImage, Tray, Notification, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// Stabilize on AMD / Temp / AV-scanned environments
try { app.disableHardwareAcceleration(); } catch (_) {}
try { app.commandLine.appendSwitch('disable-gpu'); } catch (_) {}
try { app.commandLine.appendSwitch('disable-gpu-compositing'); } catch (_) {}

const debugLogPath = (() => {
  try {
    const base = process.env.LOCALAPPDATA || app.getPath('userData');
    const dir = path.join(base, 'Xeno');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'ui-debug.log');
  } catch (_) {
    return path.join(__dirname, 'ui-debug.log');
  }
})();

const dlog = (msg) => {
  try {
    fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch (_) {}
};

process.on('uncaughtException', (err) => {
  dlog(`uncaughtException: ${err && err.stack ? err.stack : err}`);
});
process.on('unhandledRejection', (err) => {
  dlog(`unhandledRejection: ${err && err.stack ? err.stack : err}`);
});

dlog(`boot packaged=${!!(app && app.isPackaged)} exe=${process.execPath}`);

let xenoAddon = null;
try {
  const resolveAddonPath = () => {
    if (app && app.isPackaged) {
      const resources = process.resourcesPath;
      const candidates = [
        path.join(resources, 'app.asar.unpacked', 'native', 'xeno-addon', 'build', 'Release', 'xeno.node'),
        path.join(resources, 'native', 'xeno-addon', 'build', 'Release', 'xeno.node'),
        path.join(__dirname, 'native', 'xeno-addon', 'build', 'Release', 'xeno.node')
      ];
      for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch (_) {}
      }
      return null;
    }
    return path.join(__dirname, 'native', 'xeno-addon', 'build', 'Release', 'xeno.node');
  };

  const addonPath = resolveAddonPath();
  if (addonPath && fs.existsSync(addonPath)) {
    xenoAddon = require(addonPath);
  }
} catch (e) {
  xenoAddon = null;
}

let mainWindow = null;
let alwaysOnTopState = false;
let tray = null;
let isQuitting = false;
let hasShownTrayNotification = false;
let minimizeToTrayEnabled = false;
let debugConsoleEnabled = false;
let winResizable = false;

const ensureUserDirs = () => {
  try {
    const localAppData = process.platform === 'win32'
      ? (process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'))
      : app.getPath('home');
    const base = path.join(localAppData, 'Xeno');
    const autoexecDir = path.join(base, 'autoexec');
    const workspaceDir = path.join(base, 'workspace');
    try { fs.mkdirSync(autoexecDir, { recursive: true }); } catch (_) {}
    try { fs.mkdirSync(workspaceDir, { recursive: true }); } catch (_) {}
    return { autoexecDir, workspaceDir, base };
  } catch (_) {
    return null;
  }
};

const initializeXeno = () => {
  try {
    if (!xenoAddon) {
      console.error('Xeno addon not loaded');
      return;
    }
    const dllPath = app.isPackaged
      ? path.join(process.resourcesPath, 'public', 'Xeno.dll')
      : path.join(__dirname, 'public', 'Xeno.dll');
    try { process.env.XENO_DLL_PATH = dllPath; } catch (_) {}
    const ok = xenoAddon.initialize(!!debugConsoleEnabled);
    if (!ok) console.error('Failed to initialize Xeno.dll via addon');
  } catch (e) {
    console.error('Failed to initialize Xeno:', e);
  }
};

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
  return;
}

app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

ipcMain.handle('scriptblox-fetch', async (event, { endpoint, query }) => {
  try {
    const baseUrl = new URL(`https://scriptblox.com/api/${endpoint}`);
    if (query && typeof query === 'object') {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          baseUrl.searchParams.append(key, String(value));
        }
      });
    }
    const response = await fetch(baseUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('ScriptBlox request failed:', error);
    throw error;
  }
});

const createWindow = () => {
  const isDev = !app.isPackaged;
  const iconPath = isDev
    ? path.join(__dirname, 'public/Xeno.ico')
    : path.join(process.resourcesPath, 'public', 'Xeno.ico');
  app.setName('Xeno');
  app.setAppUserModelId('Xeno');

  let rdyR = false;
  let rdyW = false;
  let showT = null;

  mainWindow = new BrowserWindow({
    width: 1179,
    height: 593,
    resizable: winResizable,
    maximizable: winResizable,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      devTools: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false
    },
    titleBarStyle: 'hidden',
    frame: false,
    backgroundColor: '#000000',
    icon: iconPath,
    show: false
  });

  try {
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      dlog(`render-process-gone: ${JSON.stringify(details)}`);
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      dlog(`did-fail-load: code=${code} desc=${desc} url=${url}`);
    });
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) dlog(`console[${level}]: ${message}`);
    });
  } catch (_) {}

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    const htmlPath = path.join(__dirname, 'build', 'index.html');
    dlog(`loadFile ${htmlPath}`);
    mainWindow.loadFile(htmlPath);
  }
  
  const tryShow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!rdyW || !rdyR) return;
    try {
      if (showT) clearTimeout(showT);
    } catch (_) {}
    try { mainWindow.show(); } catch (_) {}
  };

  const onRdy = (event) => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (event && event.sender && event.sender.id !== mainWindow.webContents.id) return;
      rdyR = true;
      tryShow();
    } catch (_) {}
  };
  ipcMain.on('renderer-ready-to-show', onRdy);

  mainWindow.once('ready-to-show', () => {
    rdyW = true;
    tryShow();
    try {
      showT = setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
            mainWindow.show();
          }
        } catch (_) {}
      }, 10000);
    } catch (_) {}
  });

  mainWindow.on('closed', () => {
    try { ipcMain.removeListener('renderer-ready-to-show', onRdy); } catch (_) {}
    try { if (showT) clearTimeout(showT); } catch (_) {}
    mainWindow = null;
  });

  mainWindow.on('close', (e) => {
    dlog(`window close isQuitting=${isQuitting} tray=${minimizeToTrayEnabled}`);
    if (!isQuitting && minimizeToTrayEnabled) {
      e.preventDefault();
      try { mainWindow.hide(); } catch (_) {}
      try {
        if (!hasShownTrayNotification && Notification.isSupported()) {
          const notif = new Notification({
            title: 'Xeno is still running',
            body: 'Xeno has been minimized to the system tray. Click to reopen.',
            silent: false
          });
          notif.on('click', () => {
            try { mainWindow.show(); mainWindow.focus(); } catch (_) {}
          });
          notif.show();
          hasShownTrayNotification = true;
        }
      } catch (_) {}
    }
  });

  ipcMain.on('minimize-window', () => {
    mainWindow.minimize();
  });

  ipcMain.on('maximize-window', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('close-window', () => {
    mainWindow.close();
  });

  ipcMain.on('force-quit', () => {
    isQuitting = true;
    try { tray && tray.destroy(); } catch (_) {}
    app.quit();
  });

  ipcMain.on('set-always-on-top', (event, topmost) => {
    alwaysOnTopState = !!topmost;
    mainWindow.setAlwaysOnTop(alwaysOnTopState, 'screen-saver');
    try { mainWindow.setVisibleOnAllWorkspaces(alwaysOnTopState, { visibleOnFullScreen: true }); } catch (e) {}
    if (alwaysOnTopState) {
      try { mainWindow.moveTop(); } catch (e) {}
    }
  });

  ipcMain.handle('set-window-size', (event, width, height) => {
    mainWindow.setSize(width, height);
    return true;
  });

  ipcMain.on('set-window-resizable', (event, enabled) => {
    try {
      winResizable = !!enabled;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setResizable(winResizable);
        mainWindow.setMaximizable(winResizable);
      }
      const dirs = ensureUserDirs();
      const baseDir = dirs && dirs.base ? dirs.base : null;
      if (!baseDir) return;
      const settingsPath = path.join(baseDir, 'settings.json');
      let current = {};
      try {
        if (fs.existsSync(settingsPath)) {
          current = JSON.parse(fs.readFileSync(settingsPath, 'utf-8') || '{}');
        }
      } catch (_) { current = {}; }
      current.windowResizable = winResizable;
      fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), 'utf-8');
    } catch (_) {}
  });

  ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url);
  });

  const DIGIT_FONT = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'],
    '+': ['000', '010', '111', '010', '000']
  };

  const createStatusOverlay = (colorHex, countValue) => {
    try {
      const size = 32;
      const radius = 13;
      const center = size / 2;
      const hex = String(colorHex || '').replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16) || 0;
      const g = parseInt(hex.slice(2, 4), 16) || 0;
      const b = parseInt(hex.slice(4, 6), 16) || 0;
      const a = 255;
      const buf = Buffer.alloc(size * size * 4, 0);
      const setPixel = (x, y, rr, gg, bb, aa) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        const idx = (y * size + x) * 4;
        buf[idx] = rr;
        buf[idx + 1] = gg;
        buf[idx + 2] = bb;
        buf[idx + 3] = aa;
      };
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x + 0.5 - center;
          const dy = y + 0.5 - center;
          if (dx * dx + dy * dy <= radius * radius) {
            setPixel(x, y, r, g, b, a);
          }
        }
      }
      const numericCount = Number.isFinite(countValue) && countValue >= 0 ? Math.floor(countValue) : null;
      if (numericCount !== null) {
        let display = numericCount > 99 ? '99' : String(numericCount);
        if (display.length > 2) display = display.slice(0, 2);
        const needsPlus = numericCount > 99;
        const chars = display.split('');
        const pixelSize = 3;
        const digitWidth = 3 * pixelSize;
        const digitHeight = 5 * pixelSize;
        const spacing = chars.length > 1 ? Math.max(1, Math.floor(pixelSize / 2)) : 0;
        const totalWidth = chars.length * digitWidth + (chars.length - 1) * spacing;
        const startX = Math.floor((size - totalWidth) / 2);
        const startY = Math.floor((size - digitHeight) / 2);
        chars.forEach((char, idx) => {
          const pattern = DIGIT_FONT[char];
          if (!pattern) return;
          const offsetX = startX + idx * (digitWidth + spacing);
          pattern.forEach((row, rowIdx) => {
            for (let col = 0; col < row.length; col++) {
              if (row[col] !== '1') continue;
              for (let py = 0; py < pixelSize; py++) {
                for (let px = 0; px < pixelSize; px++) {
                  setPixel(
                    offsetX + col * pixelSize + px,
                    startY + rowIdx * pixelSize + py,
                    255,
                    255,
                    255,
                    255
                  );
                }
              }
            }
          });
        });
        if (needsPlus) {
          const plusPattern = DIGIT_FONT['+'];
          if (plusPattern) {
            const plusSize = Math.max(1, pixelSize - 1);
            const plusOffsetX = Math.min(
              size - plusSize * 3,
              startX + totalWidth - plusSize * 2
            );
            const plusOffsetY = Math.max(0, startY - plusSize);
            plusPattern.forEach((row, rowIdx) => {
              for (let col = 0; col < row.length; col++) {
                if (row[col] !== '1') continue;
                for (let py = 0; py < plusSize; py++) {
                  for (let px = 0; px < plusSize; px++) {
                    setPixel(
                      plusOffsetX + col * plusSize + px,
                      plusOffsetY + rowIdx * plusSize + py,
                      255,
                      255,
                      255,
                      255
                    );
                  }
                }
              }
            });
          }
        }
      }
      const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 1 });
      return img.resize({ width: 16, height: 16 });
    } catch (e) {
      return null;
    }
  };

  let lastTaskbarStatus = { status: 'none' };

  const normalizeTaskbarStatusPayload = (payload) => {
    if (payload && typeof payload === 'object') {
      const normalized = {
        status: typeof payload.status === 'string' ? payload.status : 'none'
      };
      if (typeof payload.showCount === 'boolean') {
        normalized.showCount = payload.showCount;
      }
      if (Number.isFinite(payload.totalClients)) {
        normalized.totalClients = Number(payload.totalClients);
      }
      if (Number.isFinite(payload.attachedClients)) {
        normalized.attachedClients = Number(payload.attachedClients);
      }
      return normalized;
    }
    return {
      status: typeof payload === 'string' ? payload : 'none'
    };
  };

  const applyTaskbarStatusOverlay = () => {
    if (!mainWindow) return;
    const wc = mainWindow;
    const minimized = mainWindow.isMinimized();
    const { status = 'none', totalClients, attachedClients, showCount = true } = lastTaskbarStatus || { status: 'none' };

    if (!minimized) {
      try {
        wc.setOverlayIcon(null, '');
        wc.setProgressBar(-1);
      } catch (_) {}
      return;
    }

    try { wc.setProgressBar(-1); } catch (_) {}

    if (!showCount) {
      wc.setOverlayIcon(null, '');
      wc.setProgressBar(-1);
      return;
    }

    let color = null;
    let description = '';
    let progressFallback = null;
    switch (status) {
      case 'attached':
        color = '#0ea868'; description = 'Attached'; progressFallback = { value: 1.0, mode: 'normal' }; break;
      case 'waiting':
        color = '#3b82f6'; description = 'Waiting for Roblox'; progressFallback = { value: 2, mode: 'indeterminate' }; break;
      case 'attaching':
        color = '#f59e0b'; description = 'Attaching'; progressFallback = { value: 0.5, mode: 'paused' }; break;
      case 'failed':
        color = '#ef4444'; description = 'Failed'; progressFallback = { value: 0.5, mode: 'error' }; break;
      case 'none':
      default:
        color = null; description = ''; progressFallback = null;
        break;
    }
    if (process.platform !== 'win32') return;
    const overlayCount = showCount
      ? (Number.isFinite(attachedClients)
        ? Math.max(0, Math.floor(attachedClients))
        : (Number.isFinite(totalClients) ? Math.max(0, Math.floor(totalClients)) : null))
      : null;
    if (color) {
      const icon = createStatusOverlay(color, overlayCount);
      if (icon && !icon.isEmpty()) {
        const desc = overlayCount !== null
          ? `${description || 'Status'} · ${overlayCount} client${overlayCount === 1 ? '' : 's'}`
          : description;
        wc.setOverlayIcon(icon, desc.trim());
        return;
      }
      if (progressFallback) {
        wc.setProgressBar(progressFallback.value, { mode: progressFallback.mode });
        return;
      }
    }
    wc.setOverlayIcon(null, '');
    wc.setProgressBar(-1);
  };

  ipcMain.on('taskbar-status', (event, payload) => {
    lastTaskbarStatus = normalizeTaskbarStatusPayload(payload);
    applyTaskbarStatusOverlay();
  });

  mainWindow.on('minimize', () => applyTaskbarStatusOverlay());
  mainWindow.on('restore', () => applyTaskbarStatusOverlay());
  mainWindow.on('focus', () => applyTaskbarStatusOverlay());
  mainWindow.on('show', () => applyTaskbarStatusOverlay());

  ipcMain.handle('fetch-changelogs', async () => {
    try {
      const response = await fetch('https://x3no.pages.dev/changelogs.txt');
      const text = await response.text();
      return text;
    } catch (error) {
      console.error('Failed to fetch changelogs:', error);
      throw error;
    }
  });

  ipcMain.handle('open-autoexec-dir', async () => {
    try {
      const localAppData = process.platform === 'win32'
        ? (process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'))
        : app.getPath('home');
      const dir = path.join(localAppData, 'Xeno', 'autoexec');
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      const result = await shell.openPath(dir);
      return { ok: result === '' };
    } catch (error) {
      console.error('Failed to open autoexec dir:', error);
      return { ok: false };
    }
  });

  ipcMain.handle('open-workspace-dir', async () => {
    try {
      const localAppData = process.platform === 'win32'
        ? (process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'))
        : app.getPath('home');
      const dir = path.join(localAppData, 'Xeno', 'workspace');
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      const result = await shell.openPath(dir);
      return { ok: result === '' };
    } catch (error) {
      console.error('Failed to open workspace dir:', error);
      return { ok: false };
    }
  });

  ipcMain.handle('read-local-file', async (_event, filePath) => {
    try {
      const p = String(filePath || '').trim().replace(/^["']|["']$/g, '');
      if (!p) return { ok: false, error: 'Empty path' };
      if (!fs.existsSync(p)) return { ok: false, error: 'File not found' };
      const st = fs.statSync(p);
      if (!st.isFile()) return { ok: false, error: 'Not a file' };
      if (st.size > 8 * 1024 * 1024) return { ok: false, error: 'File too large (max 8MB)' };
      const content = fs.readFileSync(p, 'utf8');
      return { ok: true, content, path: p, name: path.basename(p) };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('pick-local-file', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const result = await dialog.showOpenDialog(win || undefined, {
        title: 'Open script',
        properties: ['openFile'],
        filters: [
          { name: 'Scripts', extensions: ['lua', 'luau', 'txt', 'js'] },
          { name: 'All files', extensions: ['*'] }
        ]
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) {
        return { ok: false, canceled: true };
      }
      const p = result.filePaths[0];
      const st = fs.statSync(p);
      if (st.size > 8 * 1024 * 1024) return { ok: false, error: 'File too large (max 8MB)' };
      const content = fs.readFileSync(p, 'utf8');
      return { ok: true, content, path: p, name: path.basename(p) };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('xeno-version', async () => {
    if (!xenoAddon) return '';
    try { return xenoAddon.version() || ''; } catch { return ''; }
  });
  ipcMain.handle('xeno-get-clients', async () => {
    if (!xenoAddon) return [];
    try { return JSON.parse(xenoAddon.getClients() || '[]'); } catch { return []; }
  });
  ipcMain.handle('xeno-attach', async () => {
    if (!xenoAddon) return { ok: false };
    try { xenoAddon.attach(); return { ok: true }; } catch { return { ok: false }; }
  });
  ipcMain.handle('xeno-set-setting', async (event, settingType, val) => {
    if (!xenoAddon) return { ok: false };
    try {
      const map = { AutoAttach: 0, DiscordRPC: 1 };
      const typeNum = typeof settingType === 'string' ? (map[settingType] ?? 0) : Number(settingType || 0);
      xenoAddon.setSetting(Number(typeNum), Number(val||0));
      return { ok: true };
    } catch { return { ok: false }; }
  });
  const kPid = (pid) => {
    const p = Number.parseInt(String(pid || ''), 10);
    if (!Number.isFinite(p) || p <= 0) {
      return Promise.resolve({ ok: false, killed: false });
    }
    if (process.platform !== 'win32') {
      return Promise.resolve({ ok: false, killed: false });
    }
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec(`taskkill /F /PID ${p} /T`, (error, stdout, stderr) => {
        const output = ((stdout || '') + (stderr || '')).toUpperCase();
        const hasSuccess = output.includes('SUCCESS') || output.includes('TERMINATED');
        if (!error) {
          resolve({ ok: true, killed: true });
        } else if (error.code === 128) {
          resolve({ ok: true, killed: false });
        } else {
          resolve({ ok: true, killed: hasSuccess });
        }
      });
    });
  };

  ipcMain.handle('xeno-kill-roblox', async () => {
    if (!xenoAddon) return { ok: false, killed: false };
    try {
      if (typeof xenoAddon.killRoblox === 'function') {
        xenoAddon.killRoblox();
        return { ok: true, killed: true };
      }
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        return new Promise((resolve) => {
          exec('taskkill /F /IM RobloxPlayerBeta.exe /T', (error, stdout, stderr) => {
            const output = ((stdout || '') + (stderr || '')).toUpperCase();
            const hasSuccess = output.includes('SUCCESS') || output.includes('TERMINATED');
            
            if (!error) {
              resolve({ ok: true, killed: true });
            } else if (error.code === 128) {
              resolve({ ok: true, killed: false });
            } else {
              resolve({ ok: true, killed: hasSuccess });
            }
          });
        });
      }
      return { ok: false, killed: false };
    } catch { return { ok: false, killed: false }; }
  });

  ipcMain.handle('xeno-kill-roblox-pid', async (_event, pid) => {
    try {
      return await kPid(pid);
    } catch {
      return { ok: false, killed: false };
    }
  });

  try {
    let lastClientsJson = null;
    const broadcastInterval = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        if (!xenoAddon) return;
        const raw = xenoAddon.getClients();
        const json = typeof raw === 'string' ? raw : JSON.stringify(raw || []);
        if (json && json !== lastClientsJson) {
          lastClientsJson = json;
          const parsed = JSON.parse(json || '[]');
          mainWindow.webContents.send('xeno-clients', parsed);
        }
      } catch (_) {}
    }, 200);
    mainWindow.on('closed', () => {
      try { clearInterval(broadcastInterval); } catch (_) {}
    });
  } catch (_) {}

  

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('maximize-change', true);
    if (alwaysOnTopState) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      try { mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}
      try { mainWindow.moveTop(); } catch (e) {}
    }
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('maximize-change', false);
    if (alwaysOnTopState) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      try { mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}
      try { mainWindow.moveTop(); } catch (e) {}
    }
  });

  try {
    if (!isDev) {
      mainWindow.webContents.on('before-input-event', (event, input) => {
        const ctrlOrCmd = input.control || input.meta;
        if (input.type === 'keyDown') {
          const isDevtoolsCombo = input.key === 'F12' || (ctrlOrCmd && input.shift && (String(input.key || '').toUpperCase() === 'I'));
          if (isDevtoolsCombo) {
            event.preventDefault();
          }
        }
      });

      mainWindow.webContents.on('devtools-opened', () => {
        try { mainWindow.webContents.closeDevTools(); } catch (e) {}
      });
    }

    mainWindow.webContents.on('context-menu', (e, params) => {
      try {
        const editable = !!(params && (params.isEditable || params.editFlags));
        if (!editable) {
          e.preventDefault();
          return;
        }
        const menu = Menu.buildFromTemplate([
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut', enabled: !!(params.editFlags && params.editFlags.canCut) },
          { role: 'copy', enabled: !!(params.editFlags && params.editFlags.canCopy) },
          { role: 'paste', enabled: !!(params.editFlags && params.editFlags.canPaste) },
          { role: 'selectAll' }
        ]);
        menu.popup({ window: mainWindow });
      } catch (_) {
        e.preventDefault();
      }
    });
  } catch (_) {}
};

const ensureWindowsShortcut = () => {
  if (process.platform !== 'win32') return;
  try {
    const startMenuDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const shortcutPath = path.join(startMenuDir, 'Xeno.lnk');
    const isDev = !app.isPackaged;
    const iconPath = isDev
      ? path.join(__dirname, 'public/Xeno.ico')
      : path.join(process.resourcesPath, 'public', 'Xeno.ico');
    const options = {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      appUserModelId: 'Xeno',
      icon: iconPath,
      iconIndex: 0
    };
    const mode = fs.existsSync(shortcutPath) ? 'update' : 'create';
    try { fs.mkdirSync(startMenuDir, { recursive: true }); } catch (_) {}
    shell.writeShortcutLink(shortcutPath, mode, options);
  } catch (_) {}
};

const createTray = () => {
  try {
    const isDev = !app.isPackaged;
    const iconPath = isDev
      ? path.join(__dirname, 'public/Xeno.ico')
      : path.join(process.resourcesPath, 'public', 'Xeno.ico');
    tray = new Tray(iconPath);
    tray.setToolTip('Xeno');

    const showWindow = () => {
      if (!mainWindow) {
        createWindow();
      }
      try { mainWindow.show(); mainWindow.focus(); } catch (_) {}
    };

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show',
        click: () => showWindow()
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          isQuitting = true;
          try { tray.destroy(); } catch (_) {}
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => showWindow());
  } catch (e) {
  }
};

app.whenReady().then(() => {
  const dirs = ensureUserDirs();
  try {
    const baseDir = dirs && dirs.base ? dirs.base : null;
    if (baseDir) {
      const settingsPath = path.join(baseDir, 'settings.json');
      try {
        if (fs.existsSync(settingsPath)) {
          const raw = fs.readFileSync(settingsPath, 'utf-8');
          const json = JSON.parse(raw || '{}');
          debugConsoleEnabled = !!json.debugConsole;
          winResizable = typeof json.windowResizable === 'boolean' ? json.windowResizable : false;
        }
      } catch (_) {}
    }
  } catch (_) {}
  initializeXeno();
  createWindow();
  createTray();
  ensureWindowsShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('before-quit', () => {
    dlog('before-quit');
    isQuitting = true;
    try { tray && tray.destroy(); } catch (_) {}
  });
});

ipcMain.on('set-minimize-to-tray', (event, enabled) => {
  try {
    minimizeToTrayEnabled = !!enabled;
  } catch (_) {}
});

ipcMain.handle('get-debug-console', async () => {
  try {
    return !!debugConsoleEnabled;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('get-window-resizable', async () => {
  try {
    return !!winResizable;
  } catch (_) {
    return false;
  }
});

ipcMain.on('set-debug-console', (event, enabled) => {
  try {
    const dirs = ensureUserDirs();
    const baseDir = dirs && dirs.base ? dirs.base : null;
    if (!baseDir) return;
    const settingsPath = path.join(baseDir, 'settings.json');
    let current = {};
    try {
      if (fs.existsSync(settingsPath)) {
        current = JSON.parse(fs.readFileSync(settingsPath, 'utf-8') || '{}');
      }
    } catch (_) { current = {}; }
    current.debugConsole = !!enabled;
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), 'utf-8');
    debugConsoleEnabled = !!enabled;
  } catch (_) {}
});

ipcMain.on('restart-app', () => {
  try {
    isQuitting = true;
    try { tray && tray.destroy(); } catch (_) {}
    app.relaunch();
    app.exit(0);
  } catch (_) {}
});

app.on('window-all-closed', () => {
  dlog('window-all-closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const template = [
  {
    label: 'File',
    submenu: [
      {
        label: 'New',
        accelerator: 'CmdOrCtrl+N',
        click: () => {
          console.log('New');
        }
      },
      {
        label: 'Open',
        accelerator: 'CmdOrCtrl+O',
        click: () => {
          console.log('Open');
        }
      },
      { type: 'separator' },
      {
        label: 'Exit',
        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
        click: () => {
          app.quit();
        }
      }
    ]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);