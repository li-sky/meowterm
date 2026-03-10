const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // PTY
    ptyWrite: (data) => ipcRenderer.send('pty:input', data),
    ptyResize: (cols, rows) => ipcRenderer.send('pty:resize', { cols, rows }),
    onPtyData: (callback) => {
        ipcRenderer.on('pty:data', (_event, data) => callback(data));
    },
    onPtyExit: (callback) => {
        ipcRenderer.on('pty:exit', (_event, code) => callback(code));
    },

    // App
    getAppConfig: () => ipcRenderer.invoke('app:config'),

    // AI
    sendAiMessage: (message) => ipcRenderer.invoke('ai:send-message', message),
    clearAiHistory: () => ipcRenderer.invoke('ai:clear-history'),
    getAiStatus: () => ipcRenderer.invoke('ai:status'),
    onAiToolCall: (callback) => {
        ipcRenderer.on('ai:tool-call', (_event, toolCall) => callback(toolCall));
    },
});
