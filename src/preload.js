const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // PTY
    createPty: (sessionId, cwd) => ipcRenderer.send('pty:create', { sessionId, cwd }),
    closePty: (sessionId) => ipcRenderer.send('pty:close', sessionId),
    ptyWrite: (sessionId, data) => ipcRenderer.send('pty:input', { sessionId, data }),
    ptyResize: (sessionId, cols, rows) => ipcRenderer.send('pty:resize', { sessionId, cols, rows }),
    onPtyData: (callback) => {
        ipcRenderer.on('pty:data', (_event, { sessionId, data }) => callback(sessionId, data));
    },
    onPtyExit: (callback) => {
        ipcRenderer.on('pty:exit', (_event, { sessionId, code }) => callback(sessionId, code));
    },

    // App
    getAppConfig: () => ipcRenderer.invoke('app:config'),
    onRestoreSessions: (callback) => {
        ipcRenderer.on('app:restore-sessions', (_event, sessions) => callback(sessions));
    },

    // AI
    sendAiMessage: (sessionId, message) => ipcRenderer.invoke('ai:send-message', { sessionId, message }),
    stopAiMessage: (sessionId) => ipcRenderer.invoke('ai:abort-message', sessionId),
    clearAiHistory: (sessionId) => ipcRenderer.invoke('ai:clear-history', sessionId),
    getAiStatus: () => ipcRenderer.invoke('ai:status'),
    onAiToolCall: (callback) => {
        ipcRenderer.on('ai:tool-call', (_event, { sessionId, toolCall }) => callback(sessionId, toolCall));
    },
    onAiRequestScreen: (callback) => {
        ipcRenderer.on('ai:request-screen', () => callback());
    },
    onAiRequestHistory: (callback) => {
        ipcRenderer.on('ai:request-history', (_event, lines) => callback(lines));
    },
    sendAiScreenData: (data) => ipcRenderer.send('ai:screen-data', data),
    sendAiHistoryData: (data) => ipcRenderer.send('ai:history-data', data),
});
