import './index.css';
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

// =====================
// Terminal Setup
// =====================

// =====================
// Session Management
// =====================

const sessions = new Map(); // sessionId -> { term, fitAddon, tabEl, wrapperEl }
let activeSessionId = null;

const tabsListEl = document.getElementById('tabs-list');
const newTabBtn = document.getElementById('new-tab-btn');
const terminalContainerEl = document.getElementById('terminal-container');

// Global config cache
let currentConfig = null;

function createTerminalInstance() {
  const term = new Terminal({
    fontFamily: currentConfig?.terminal?.fontFamily || "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    fontSize: currentConfig?.terminal?.fontSize || 14,
    lineHeight: 1.3,
    cursorBlink: true,
    cursorStyle: 'bar',
    theme: {
      background: '#0d0d0d',
      foreground: '#e8e8e8',
      cursor: '#7c5cff',
      cursorAccent: '#0d0d0d',
      selectionBackground: 'rgba(124, 92, 255, 0.3)',
      selectionForeground: '#ffffff',
      black: '#1a1a2e',
      brightBlack: '#4a4a5a',
      red: '#ff5f5f',
      brightRed: '#ff8080',
      green: '#00d4aa',
      brightGreen: '#33e0be',
      yellow: '#ffd866',
      brightYellow: '#ffe099',
      blue: '#7c5cff',
      brightBlue: '#9b82ff',
      magenta: '#e06caa',
      brightMagenta: '#e899c4',
      cyan: '#56d8c9',
      brightCyan: '#7ee3d8',
      white: '#cccccc',
      brightWhite: '#ffffff',
    },
    allowTransparency: true,
    scrollback: 5000,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  return { term, fitAddon };
}

function switchSession(sessionId) {
  if (activeSessionId === sessionId) return;

  // Deactivate old
  if (activeSessionId && sessions.has(activeSessionId)) {
    const oldSession = sessions.get(activeSessionId);
    oldSession.tabEl.classList.remove('active');
    oldSession.wrapperEl.classList.remove('active');
  }

  activeSessionId = sessionId;

  // Activate new
  if (sessions.has(sessionId)) {
    const newSession = sessions.get(sessionId);
    newSession.tabEl.classList.add('active');
    newSession.wrapperEl.classList.add('active');
    
    // Fit and focus after making it visible
    setTimeout(() => {
      newSession.fitAddon.fit();
      newSession.term.focus();
    }, 10);
    
    // Swap chat history UI
    loadChatHistory(sessionId);
  }
}

function createSessionUI(sessionId, title = 'Terminal') {
  // Tab UI
  const tabEl = document.createElement('div');
  tabEl.classList.add('tab');
  tabEl.innerHTML = `
    <span class="tab-title">${title}</span>
    <span class="tab-close" title="Close Session">×</span>
  `;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      closeSession(sessionId);
    } else {
      switchSession(sessionId);
    }
  });

  tabsListEl.appendChild(tabEl);

  // Terminal UI
  const wrapperEl = document.createElement('div');
  wrapperEl.classList.add('terminal-wrapper');
  terminalContainerEl.appendChild(wrapperEl);

  const { term, fitAddon } = createTerminalInstance();
  term.open(wrapperEl);

  const sessionData = { term, fitAddon, tabEl, wrapperEl };
  sessions.set(sessionId, sessionData);

  // Wire PTY I/O
  term.onData((data) => window.api.ptyWrite(sessionId, data));
  term.onResize(({ cols, rows }) => window.api.ptyResize(sessionId, cols, rows));

  return sessionData;
}

function closeSession(sessionId) {
  if (!sessions.has(sessionId)) return;

  // 1. Tell backend to kill process
  window.api.closePty(sessionId);

  // 2. Remove UI
  const session = sessions.get(sessionId);
  session.term.dispose();
  session.tabEl.remove();
  session.wrapperEl.remove();
  sessions.delete(sessionId);
  
  // Clear local chat history
  chatHistories.delete(sessionId);

  // 3. Switch to another tab if we closed the active one
  if (activeSessionId === sessionId) {
    activeSessionId = null;
    const remainingIds = Array.from(sessions.keys());
    if (remainingIds.length > 0) {
      switchSession(remainingIds[remainingIds.length - 1]);
    } else {
      // If no tabs left, clear chat
      chatMessages.innerHTML = '';
    }
  }
}

// Global PTY Event Listeners
window.api.onPtyData((sessionId, data) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.term.write(data);
  }
});

window.api.onPtyExit((sessionId, code) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.term.write(`\r\n\x1b[31m[Process exited with code ${code}]\x1b[0m\r\n`);
  }
});

// Restore Sessions on Load
window.api.onRestoreSessions((restoredSessions) => {
  if (restoredSessions && restoredSessions.length > 0) {
    restoredSessions.forEach(s => {
      createSessionUI(s.id);
    });
    // Switch to first tab
    switchSession(restoredSessions[0].id);
  }
});

// New Tab Button
newTabBtn.addEventListener('click', () => {
  const newId = 'session-' + Date.now();
  createSessionUI(newId);
  window.api.createPty(newId, null);
  switchSession(newId);
});

// Screen Capture for AI (Active Session)
window.api.onAiRequestScreen(() => {
  if (!activeSessionId || !sessions.has(activeSessionId)) return;
  const term = sessions.get(activeSessionId).term;
  
  const buffer = term.buffer.active;
  const lines = [];

  const startRow = Math.max(0, buffer.baseY);
  const endRow = buffer.baseY + term.rows;

  for (let i = startRow; i < endRow; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  window.api.sendAiScreenData(lines.join('\n'));
});

// History Capture for AI (Active Session)
window.api.onAiRequestHistory((numLines) => {
  if (!activeSessionId || !sessions.has(activeSessionId)) return;
  const term = sessions.get(activeSessionId).term;

  const buffer = term.buffer.active;
  const lines = [];
  const requestedLines = Math.min(numLines || 200, 500);

  const startRow = Math.max(0, buffer.baseY + term.rows - requestedLines);
  const endRow = buffer.baseY + term.rows;

  for (let i = startRow; i < endRow; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  window.api.sendAiHistoryData(lines.join('\n'));
});

// Config and options
async function applyConfig() {
  try {
    currentConfig = await window.api.getAppConfig();
    if (currentConfig) {
      // Update all existing terminals
      for (const session of sessions.values()) {
        if (currentConfig.terminal?.fontFamily) session.term.options.fontFamily = currentConfig.terminal.fontFamily;
        if (currentConfig.terminal?.fontSize) session.term.options.fontSize = currentConfig.terminal.fontSize;
      }

      if (currentConfig.chat?.fontFamily) {
        document.documentElement.style.setProperty('--chat-font-family', currentConfig.chat.fontFamily);
      }
      if (currentConfig.chat?.fontSize) {
        document.documentElement.style.setProperty('--chat-font-size', currentConfig.chat.fontSize + 'px');
      }

      // Re-fit active
      if (activeSessionId && sessions.has(activeSessionId)) {
        sessions.get(activeSessionId).fitAddon.fit();
      }
    }
  } catch (e) {
    console.error('Failed to load config', e);
  }
}
applyConfig();

// Handle resize
const resizeObserver = new ResizeObserver(() => {
  if (activeSessionId && sessions.has(activeSessionId)) {
    const session = sessions.get(activeSessionId);
    try {
      session.fitAddon.fit();
      // Only resize PTY if term is fully initialized
      if (session.term.cols && session.term.rows) {
        window.api.ptyResize(activeSessionId, session.term.cols, session.term.rows);
      }
    } catch (e) {
      // ignore
    }
  }
});
resizeObserver.observe(terminalContainerEl);

// =====================
// Chat Panel
// =====================

const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('chat-send-btn');
const stopBtn = document.getElementById('chat-stop-btn');
const toggleBtn = document.getElementById('toggle-chat-btn');
const clearBtn = document.getElementById('clear-chat-btn');
const statusBadge = document.getElementById('ai-status-badge');
const resizeHandle = document.getElementById('resize-handle');

let isLoading = false;

// Check AI status
async function checkAiStatus() {
  try {
    const status = await window.api.getAiStatus();
    if (status.configured) {
      statusBadge.textContent = status.model;
      statusBadge.classList.add('connected');
      statusBadge.classList.remove('disconnected');
    } else {
      statusBadge.textContent = 'no API key';
      statusBadge.classList.add('disconnected');
      statusBadge.classList.remove('connected');
    }
  } catch (e) {
    statusBadge.textContent = 'error';
    statusBadge.classList.add('disconnected');
  }
}
checkAiStatus();

// Toggle chat panel
toggleBtn.addEventListener('click', () => {
  chatPanel.classList.toggle('collapsed');
  toggleBtn.textContent = chatPanel.classList.contains('collapsed') ? '▲' : '▼';
  // Re-fit terminal after animation
  setTimeout(() => fitAddon.fit(), 250);
});

const chatHistories = new Map(); // sessionId -> array of { html, type }

// Clear chat
clearBtn.addEventListener('click', async () => {
  if (!activeSessionId) return;
  chatMessages.innerHTML = '';
  chatHistories.set(activeSessionId, []);
  await window.api.clearAiHistory(activeSessionId);
});

// Add message to local cache and DOM
function saveToHistory(sessionId, htmlStr, type = 'message') {
  if (!chatHistories.has(sessionId)) {
    chatHistories.set(sessionId, []);
  }
  chatHistories.get(sessionId).push({ html: htmlStr, type });
}

function loadChatHistory(sessionId) {
  chatMessages.innerHTML = '';
  const history = chatHistories.get(sessionId) || [];
  history.forEach(item => {
    // we use a temp div to parse the html string
    const temp = document.createElement('div');
    temp.innerHTML = item.html;
    chatMessages.appendChild(temp.firstElementChild);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Add message to chat DOM
function addMessage(role, content, typewriter = false) {
  if (!activeSessionId) return;
  const currentSessionId = activeSessionId; // Capture for async ops

  const msgEl = document.createElement('div');
  msgEl.classList.add('message', role);

  const prefixEl = document.createElement('div');
  prefixEl.classList.add('message-prefix');
  
  const nameEl = document.createElement('span');
  if (role === 'user') {
    nameEl.textContent = 'USER';
  } else if (role === 'assistant') {
    nameEl.textContent = '🐱';
  } else {
    nameEl.textContent = '⚠️';
  }
  
  const arrowEl = document.createElement('span');
  arrowEl.textContent = '>';
  
  prefixEl.appendChild(nameEl);
  prefixEl.appendChild(arrowEl);
  msgEl.appendChild(prefixEl);

  const contentEl = document.createElement('div');
  contentEl.classList.add('message-content');
  msgEl.appendChild(contentEl);
  chatMessages.appendChild(msgEl);

  if (typewriter && role === 'assistant') {
    let i = 0;
    const speed = 15;
    const interval = setInterval(() => {
      // Only update DOM if we are still on the same tab
      if (activeSessionId === currentSessionId) {
        contentEl.innerHTML = formatMarkdown(content.slice(0, i));
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
      i += 2;
      if (i > content.length) {
        contentEl.innerHTML = formatMarkdown(content);
        if (activeSessionId === currentSessionId) {
           chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        saveToHistory(currentSessionId, msgEl.outerHTML);
        clearInterval(interval);
      }
    }, speed);
  } else {
    contentEl.innerHTML = formatMarkdown(content);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    saveToHistory(currentSessionId, msgEl.outerHTML);
  }
}

// Add tool call indicator
function addToolCall(name, args, hint) {
  if (!activeSessionId) return;

  const el = document.createElement('div');
  el.classList.add('message', 'tool');

  const prefixEl = document.createElement('div');
  prefixEl.classList.add('message-prefix');
  
  const nameEl = document.createElement('span');
  nameEl.textContent = '🐱';
  
  const arrowEl = document.createElement('span');
  arrowEl.textContent = '>';
  
  prefixEl.appendChild(nameEl);
  prefixEl.appendChild(arrowEl);

  const contentEl = document.createElement('div');
  contentEl.classList.add('message-content');

  const argsStr = Object.entries(args || {})
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');

  contentEl.textContent = `[${name}] ${argsStr}`;

  if (hint) {
    const hintEl = document.createElement('span');
    hintEl.classList.add('tool-hint');
    hintEl.textContent = hint;
    contentEl.appendChild(hintEl);
  }

  el.appendChild(prefixEl);
  el.appendChild(contentEl);

  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  saveToHistory(activeSessionId, el.outerHTML, 'tool');
}

// Add thinking indicator
function addThinking() {
  removeThinking();
  const el = document.createElement('div');
  el.classList.add('thinking');
  el.id = 'thinking-indicator';
  el.innerHTML = `
    <div class="thinking-dots">
      <span></span><span></span><span></span>
    </div>
    <span>Thinking...</span>
  `;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeThinking() {
  document.querySelectorAll('.thinking').forEach(el => el.remove());
}

// Send message
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isLoading || !activeSessionId) return;

  const currentSessionId = activeSessionId;
  isLoading = true;
  sendBtn.style.display = 'none';
  stopBtn.style.display = 'flex';
  chatInput.value = '';
  chatInput.style.height = 'auto';

  addMessage('user', text);
  addThinking();

  try {
    const result = await window.api.sendAiMessage(currentSessionId, text);
    if (activeSessionId === currentSessionId) {
       removeThinking();
    }

    if (result.error) {
      if (result.error.includes('AbortError')) {
        addMessage('error', '⚠️ Generation stopped by user.');
      } else {
        addMessage('error', `⚠️ ${result.error}`);
      }
    } else if (result.content) {
      addMessage('assistant', result.content, true);
    }
  } catch (err) {
    if (activeSessionId === currentSessionId) removeThinking();
    addMessage('error', `⚠️ Failed to get response: ${err.message}`);
  }

  isLoading = false;
  if (activeSessionId === currentSessionId) {
      sendBtn.style.display = 'flex';
      stopBtn.style.display = 'none';
      chatInput.focus();
  }
}

// Listen for tool calls from main process
window.api.onAiToolCall((targetSessionId, toolCall) => {
  if (activeSessionId === targetSessionId) {
    removeThinking();
  }
  
  // Actually render it if it's the active view
  if (activeSessionId === targetSessionId) {
      addToolCall(toolCall.name, toolCall.args, toolCall.hint);
      addThinking();
  } else {
      // Save it "silently" into history for the other tab
      const el = document.createElement('div');
      el.classList.add('message', 'tool');
      el.innerHTML = `<div class="message-prefix"><span>🐱</span><span>&gt;</span></div>
                      <div class="message-content">[${toolCall.name}] ${JSON.stringify(toolCall.args)}</div>`;
      saveToHistory(targetSessionId, el.outerHTML, 'tool');
  }
});

// Send button
sendBtn.addEventListener('click', sendMessage);

// Stop button
stopBtn.addEventListener('click', () => {
  if (isLoading && activeSessionId) {
    window.api.stopAiMessage(activeSessionId);
  }
});

// Enter to send, Shift+Enter for newline
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
});

// =====================
// Resize Handle
// =====================

let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  document.body.style.cursor = 'ns-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const appEl = document.getElementById('app');
  const appRect = appEl.getBoundingClientRect();
  const mouseY = e.clientY - appRect.top;
  const newChatHeight = appRect.height - mouseY;

  // Clamp
  const clamped = Math.max(60, Math.min(newChatHeight, appRect.height - 100));
  chatPanel.style.height = clamped + 'px';

  // Re-fit terminal
  fitAddon.fit();
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    fitAddon.fit();
  }
});

// =====================
// Helpers
// =====================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Simple markdown-ish formatting for chat messages */
function formatMarkdown(text) {
  let html = escapeHtml(text);

  // Parse <think>...</think> tags into collapsible details
  html = html.replace(/&lt;think&gt;([\s\S]*?)(?:&lt;\/think&gt;|$)/g, (match, content) => {
      return `<details class="think-details"><summary>Thinking...</summary><div class="think-content">${content.trim()}</div></details>`;
  });

  // Code blocks (```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Focus terminal on click outside chat
document.getElementById('terminal-container').addEventListener('click', () => {
  if (activeSessionId && sessions.has(activeSessionId)) {
    sessions.get(activeSessionId).term.focus();
  }
});
