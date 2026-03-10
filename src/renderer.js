import './index.css';
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

// =====================
// Terminal Setup
// =====================

const term = new Terminal({
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
  fontSize: 14,
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

const terminalEl = document.getElementById('terminal');
term.open(terminalEl);

// Fit on load
setTimeout(() => fitAddon.fit(), 100);

// Wire PTY I/O
term.onData((data) => window.api.ptyWrite(data));
window.api.onPtyData((data) => term.write(data));
window.api.onPtyExit((code) => {
  term.write(`\r\n\x1b[31m[Process exited with code ${code}]\x1b[0m\r\n`);
});

// Fetch config and update terminal options
async function applyConfig() {
  try {
    const config = await window.api.getAppConfig();
    if (config) {
      if (config.fontFamily) term.options.fontFamily = config.fontFamily;
      if (config.fontSize) term.options.fontSize = config.fontSize;

      // Re-fit in case font size changed
      fitAddon.fit();
    }
  } catch (e) {
    console.error('Failed to load config', e);
  }
}
applyConfig();

// Handle resize
const resizeObserver = new ResizeObserver(() => {
  try {
    fitAddon.fit();
    window.api.ptyResize(term.cols, term.rows);
  } catch (e) {
    // ignore
  }
});
resizeObserver.observe(terminalEl);

// =====================
// Chat Panel
// =====================

const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('chat-send-btn');
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

// Clear chat
clearBtn.addEventListener('click', async () => {
  chatMessages.innerHTML = '';
  await window.api.clearAiHistory();
  addWelcomeMessage();
});

// Welcome message
function addWelcomeMessage() {
  addMessage(
    'assistant',
    'Hey! 🐱 I\'m your MeowTerm AI assistant.\n\nI can:\n• **Capture** the terminal screen\n• **Read** files from your system\n• **Type** commands into the terminal\n\nJust tell me what you need!'
  );
}
addWelcomeMessage();

// Add message to chat
function addMessage(role, content) {
  const msgEl = document.createElement('div');
  msgEl.classList.add('message', role);

  const contentEl = document.createElement('div');
  contentEl.classList.add('message-content');
  contentEl.innerHTML = formatMarkdown(content);

  msgEl.appendChild(contentEl);
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Add tool call indicator
function addToolCall(name, args) {
  const el = document.createElement('div');
  el.classList.add('tool-call');

  const icons = {
    capture_screen: '📸',
    fetch_file: '📄',
    type_keyboard: '⌨️',
  };

  const argsStr = Object.entries(args || {})
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');

  el.innerHTML = `
    <span class="tool-icon">${icons[name] || '🔧'}</span>
    <span class="tool-name">${name}</span>
    ${argsStr ? `<span class="tool-args">${escapeHtml(argsStr)}</span>` : ''}
  `;

  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Add thinking indicator
function addThinking() {
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
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
}

// Send message
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isLoading) return;

  isLoading = true;
  sendBtn.disabled = true;
  chatInput.value = '';
  chatInput.style.height = 'auto';

  addMessage('user', text);
  addThinking();

  try {
    const result = await window.api.sendAiMessage(text);
    removeThinking();

    if (result.error) {
      addMessage('error', `⚠️ ${result.error}`);
    } else if (result.content) {
      addMessage('assistant', result.content);
    }
  } catch (err) {
    removeThinking();
    addMessage('error', `⚠️ Failed to get response: ${err.message}`);
  }

  isLoading = false;
  sendBtn.disabled = false;
  chatInput.focus();
}

// Listen for tool calls from main process
window.api.onAiToolCall((toolCall) => {
  removeThinking();
  addToolCall(toolCall.name, toolCall.args);
  addThinking();
});

// Send button
sendBtn.addEventListener('click', sendMessage);

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
  term.focus();
});

// Initial focus
setTimeout(() => term.focus(), 200);
