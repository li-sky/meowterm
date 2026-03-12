import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { AIService } from './main/ai-service.js';

// --- Config Setup ---
import { loadConfig, getMergedAiConfig } from './main/config.js';
let appConfig = loadConfig();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// --- PTY Setup & Session Management ---
const sessions = new Map(); // sessionId -> { ptyProcess, terminalBuffer, cwd }
const MAX_BUFFER_LINES = 5000;
const SESSION_FILE = path.join(os.homedir(), '.meowterm-sessions.json');

function saveSessions() {
  const sessionData = Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    cwd: session.cwd,
  }));
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
  } catch (err) {
    console.error('Failed to save sessions:', err);
  }
}

function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        return data; // Array of { id, cwd }
      }
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
  return null;
}

function spawnPty(sessionId, cwd = null, cols = 120, rows = 30, mainWindow) {
  const pty = require('node-pty');

  let shell = process.env.MEOWTERM_SHELL ||
    (process.platform === 'win32'
      ? process.env.COMSPEC ? process.env.COMSPEC : 'pwsh.exe'
      : process.env.SHELL || '/bin/bash');

  if (appConfig?.terminal?.shell) {
    shell = appConfig.terminal.shell;
  }

  const shellArgs = process.platform === 'win32' ? [] : ['--login'];
  
  const startingCwd = cwd || process.env.HOME || process.env.USERPROFILE || os.homedir();

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: startingCwd,
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  const session = {
    ptyProcess,
    terminalBuffer: [],
    cwd: startingCwd,
  };
  sessions.set(sessionId, session);

  ptyProcess.onData((data) => {
    const lines = data.split('\n');
    session.terminalBuffer.push(...lines);
    while (session.terminalBuffer.length > MAX_BUFFER_LINES) {
      session.terminalBuffer.shift();
    }
    mainWindow.webContents.send('pty:data', { sessionId, data });
  });

  ptyProcess.onExit(({ exitCode }) => {
    mainWindow.webContents.send('pty:exit', { sessionId, exitCode });
    sessions.delete(sessionId);
    saveSessions();
  });

  saveSessions();
  return ptyProcess;
}

function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.ptyProcess) {
    session.ptyProcess.kill();
    sessions.delete(sessionId);
    saveSessions();
  }
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

  // Open the DevTools only in development.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools();
  }

  // Spawn PTY when renderer is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const previousSessions = loadSessions();
    
    if (previousSessions) {
      // Recreate previous sessions
      for (const s of previousSessions) {
        spawnPty(s.id, s.cwd, 120, 30, mainWindow);
      }
      mainWindow.webContents.send('app:restore-sessions', previousSessions);
    } else {
      // Create a default session if no history exists
      const defaultId = 'session-' + Date.now();
      spawnPty(defaultId, null, 120, 30, mainWindow);
      mainWindow.webContents.send('app:restore-sessions', [{ id: defaultId, cwd: null }]);
    }
  });

  // --- IPC Handlers ---

  ipcMain.on('pty:create', (event, { sessionId, cwd }) => {
    spawnPty(sessionId, cwd, 120, 30, mainWindow);
  });

  ipcMain.on('pty:close', (event, sessionId) => {
    closeSession(sessionId);
  });

  // PTY input from renderer
  ipcMain.on('pty:input', (_event, { sessionId, data }) => {
    const session = sessions.get(sessionId);
    if (session && session.ptyProcess) {
      session.ptyProcess.write(data);
    }
  });

  // PTY resize
  ipcMain.on('pty:resize', (_event, { sessionId, cols, rows }) => {
    const session = sessions.get(sessionId);
    if (session && session.ptyProcess) {
      try {
        session.ptyProcess.resize(cols, rows);
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
  ipcMain.handle('ai:send-message', async (_event, { sessionId, message }) => {
    const session = sessions.get(sessionId);
    if (!session) return { error: `Session not found: ${sessionId}` };

    const result = await aiService.sendMessage(message, {
      sessionId,
      ptyProcess: session.ptyProcess,
      mainWindow,
      cwd: session.cwd,
      onToolCall: (toolCall) => {
        mainWindow.webContents.send('ai:tool-call', { sessionId, toolCall });
      },
    });
    return result;
  });

  // AI: abort message
  ipcMain.handle('ai:abort-message', async (_event, sessionId) => {
    aiService.abortMessage(sessionId);
    return { success: true };
  });

  // AI: clear history
  ipcMain.handle('ai:clear-history', async (_event, sessionId) => {
    aiService.clearHistory(sessionId);
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
  for (const session of sessions.values()) {
    if (session.ptyProcess) {
      session.ptyProcess.kill();
    }
  }
  sessions.clear();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
