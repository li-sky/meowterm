import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import os from 'node:os';
import started from 'electron-squirrel-startup';
import { AIService } from './main/ai-service.js';

// --- Config Setup ---
import { loadConfig, getMergedAiConfig } from './main/config.js';
let appConfig = loadConfig();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// --- PTY Setup ---
let ptyProcess = null;
const terminalBuffer = [];
const MAX_BUFFER_LINES = 5000;

function spawnPty(cols = 120, rows = 30) {
  // node-pty must be required (not imported) because it's a native module
  // and we externalized it from the Vite bundle
  const pty = require('node-pty');

  let shell = process.env.MEOWTERM_SHELL ||
    (process.platform === 'win32'
      ? process.env.COMSPEC
        ? process.env.COMSPEC
        : 'pwsh.exe'
      : process.env.SHELL || '/bin/bash');

  if (appConfig?.terminal?.shell) {
    shell = appConfig.terminal.shell;
  }

  const shellArgs = process.platform === 'win32' ? [] : ['--login'];

  ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME || process.env.USERPROFILE || os.homedir(),
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  return ptyProcess;
}

// --- AI Service ---
const aiService = new AIService();
aiService.setConfig(getMergedAiConfig(appConfig));

// --- Window ---
const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d0d0d',
      symbolColor: '#999',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the app
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // Spawn PTY when renderer is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const pty = spawnPty();

    pty.onData((data) => {
      // Track buffer for capture_screen
      const lines = data.split('\n');
      terminalBuffer.push(...lines);
      while (terminalBuffer.length > MAX_BUFFER_LINES) {
        terminalBuffer.shift();
      }

      mainWindow.webContents.send('pty:data', data);
    });

    pty.onExit(({ exitCode }) => {
      mainWindow.webContents.send('pty:exit', exitCode);
    });
  });

  // --- IPC Handlers ---

  // PTY input from renderer
  ipcMain.on('pty:input', (_event, data) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  // PTY resize
  ipcMain.on('pty:resize', (_event, { cols, rows }) => {
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows);
      } catch (e) {
        // ignore resize errors
      }
    }
  });

  // App Config
  ipcMain.handle('app:config', () => {
    return {
      terminal: appConfig.terminal,
      chat: appConfig.chat,
    };
  });

  // AI: send message
  ipcMain.handle('ai:send-message', async (_event, message) => {
    const result = await aiService.sendMessage(message, {
      ptyProcess,
      mainWindow,
      cwd: process.env.HOME || process.env.USERPROFILE || os.homedir(),
      onToolCall: (toolCall) => {
        mainWindow.webContents.send('ai:tool-call', toolCall);
      },
    });
    return result;
  });

  // AI: abort message
  ipcMain.handle('ai:abort-message', async () => {
    aiService.abortMessage();
    return { success: true };
  });

  // AI: clear history
  ipcMain.handle('ai:clear-history', async () => {
    aiService.clearHistory();
    return { success: true };
  });

  // AI: check if configured
  ipcMain.handle('ai:status', async () => {
    const hasKey = !!aiService.config.apiKey;
    return {
      configured: hasKey,
      model: aiService.model,
    };
  });
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (ptyProcess) {
    ptyProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
