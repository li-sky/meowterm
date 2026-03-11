import fs from 'node:fs';
import path from 'node:path';

/**
 * Capture the current terminal screen content.
 * Requests the visible screen from the renderer's xterm.js instance via IPC.
 */
export async function captureCurrentScreen(mainWindow) {
    return new Promise((resolve) => {
        // Send request to renderer
        mainWindow.webContents.send('ai:request-screen');

        // Listen for the one-time response
        const { ipcMain } = require('electron');
        ipcMain.once('ai:screen-data', (_event, data) => {
            resolve(data || '(terminal is empty)');
        });

        // Timeout just in case
        setTimeout(() => resolve('(screen capture timeout)'), 2000);
    });
}

/**
 * Capture the history terminal screen content.
 * Requests historical lines from the renderer's xterm.js instance via IPC.
 */
export async function getHistoryOutput(mainWindow, lines = 200) {
    return new Promise((resolve) => {
        // Send request to renderer
        mainWindow.webContents.send('ai:request-history', lines);

        // Listen for the one-time response
        const { ipcMain } = require('electron');
        ipcMain.once('ai:history-data', (_event, data) => {
            resolve(data || '(terminal history is empty)');
        });

        // Timeout just in case
        setTimeout(() => resolve('(history capture timeout)'), 2000);
    });
}

/**
 * Fetch/read a file from disk.
 * @param {string} filePath - Absolute or relative path to the file
 * @param {string} [cwd] - Current working directory for resolving relative paths
 * @returns {string} File content or error message
 */
export function fetchFile(filePath, cwd) {
    try {
        const resolved = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(cwd || process.cwd(), filePath);

        if (!fs.existsSync(resolved)) {
            return `Error: File not found: ${resolved}`;
        }

        const stats = fs.statSync(resolved);
        if (stats.isDirectory()) {
            // List directory contents
            const entries = fs.readdirSync(resolved, { withFileTypes: true });
            const listing = entries.map((e) => {
                const type = e.isDirectory() ? '[DIR]' : '[FILE]';
                return `${type} ${e.name}`;
            });
            return `Directory listing for: ${resolved}\n\n${listing.join('\n')}`;
        }

        // Limit file size to 100KB
        const MAX_SIZE = 100 * 1024;
        if (stats.size > MAX_SIZE) {
            return `Error: File too large (${(stats.size / 1024).toFixed(1)}KB). Max is 100KB.`;
        }

        return fs.readFileSync(resolved, 'utf-8');
    } catch (err) {
        return `Error reading file: ${err.message}`;
    }
}

/**
 * Type text into the terminal (write to PTY stdin).
 * @param {object} ptyProcess - The node-pty process
 * @param {string} text - Text to type into the terminal
 */
export function typeKeyboard(ptyProcess, text) {
    if (!ptyProcess) {
        return 'Error: No terminal process available';
    }
    try {
        // Unescape special tokens the AI might output, and also convert natural newlines
        const unescapedText = text
            .replace(/<enter>/gi, '\r')
            .replace(/<tab>/gi, '\t')
            .replace(/<esc>/gi, '\x1b')
            .replace(/\n/g, '\r');

        ptyProcess.write(unescapedText);
        return `Typed ${unescapedText.length} characters into terminal`;
    } catch (err) {
        return `Error typing to terminal: ${err.message}`;
    }
}

/**
 * Check if the terminal is at a shell prompt using a small LLM or heuristic fallback.
 */
async function checkTerminalReady(screenData, client, model) {
    if (!screenData || typeof screenData !== 'string') return false;
    
    const lines = screenData.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return true; // empty screen = ready

    const lastLines = lines.slice(-5).join('\n');
    
    try {
        const response = await client.chat.completions.create({
            model: model || 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are a terminal state analyzer. Your only job is to determine whether the provided terminal tail (the last few lines of the screen) shows that the terminal is currently idle at a shell prompt waiting for user input, or if it is currently running a process, displaying output, or inside a TUI program like vim. Reply EXACTLY with "YES" if it is at a prompt, or "NO" if it is not.'
                },
                {
                    role: 'user',
                    content: lastLines
                }
            ],
            temperature: 0,
            max_tokens: 5,
        });

        const reply = (response.choices[0]?.message?.content || '').trim().toUpperCase();
        return reply.includes('YES');
    } catch (e) {
        console.error('Error checking terminal state with LLM, falling back to heuristic:', e.message);
        // Fallback: Check if the last line ends with common prompt characters
        const lastLine = lines[lines.length - 1];
        return /[$>#%❯➜]\s*$/.test(lastLine.trim());
    }
}

/**
 * Safely execute a shell command by checking terminal state first.
 * If safe, executes it and waits temporarily to capture resulting output.
 */
export async function runCommand(mainWindow, ptyProcess, command, client, model) {
    if (!ptyProcess) {
        return 'Error: No terminal process available';
    }
    
    try {
        const screenData = await captureCurrentScreen(mainWindow);
        const isReady = await checkTerminalReady(screenData, client, model);
        
        if (!isReady) {
            return `Error: The terminal appears to be busy or running an application, cannot safely execute: "${command}". Use type_keyboard if you are purposefully interacting with a running application.`;
        }
        
        return new Promise((resolve) => {
            let output = [];
            let finished = false;
            let timeoutId;
            let debounceId;
            
            // Listen for data
            const disposable = ptyProcess.onData((data) => {
                if (!finished) {
                    output.push(data);
                    
                    // Reset calm-down debounce timer
                    clearTimeout(debounceId);
                    debounceId = setTimeout(() => finish(), 1000); // 1s of no output = done
                }
            });
            
            // Initial write
            ptyProcess.write(command + '\r');
            
            // Absolute max wait of 5 seconds
            timeoutId = setTimeout(() => finish(), 5000);
            
            function finish() {
                if (finished) return;
                finished = true;
                clearTimeout(timeoutId);
                clearTimeout(debounceId);
                disposable.dispose();
                
                const finalStr = output.join('').replace(/\r/g, '');
                
                // Return only the tail if it's very long
                const lines = finalStr.split('\n');
                if (lines.length > 200) {
                    resolve(lines.slice(-200).join('\n') + '\n\n(output truncated, showing last 200 lines)');
                } else {
                    resolve(finalStr || `Successfully executed command: ${command} (no output)`);
                }
            }
        });
    } catch (err) {
        return `Error running command: ${err.message}`;
    }
}

/**
 * Tool definitions for the OpenAI function calling API.
 */
export const toolDefinitions = [
    {
        type: 'function',
        function: {
            name: 'capture_current_screen',
            description:
                'Capture the current terminal screen content. Returns only the text currently visible in the terminal buffer.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_history_output',
            description:
                'Get the history output of the terminal. Returns up to the specified number of historical lines (max 500).',
            parameters: {
                type: 'object',
                properties: {
                    lines: {
                        type: 'number',
                        description: 'Number of lines to retrieve (maximum 500). Default is usually 200.',
                    },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'fetch_file',
            description:
                'Read a file from the filesystem. If the path is a directory, lists its contents. Supports absolute and relative paths (relative to the terminal working directory).',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The file path to read. Can be absolute or relative.',
                    },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description:
                'Safely execute a shell command. It automatically checks if the terminal is ready at a prompt before typing. Use this for standard shell commands rather than type_keyboard.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to execute.',
                    },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'type_keyboard',
            description:
                'Type text into the terminal. This sends keystrokes to the terminal as if the user typed them. Use <enter> for Enter key. For example, to run a command, send "ls -la<enter>".',
            parameters: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description:
                            'The text to type into the terminal. Use <enter> for Enter, <tab> for Tab, <esc> for Escape.',
                    },
                },
                required: ['text'],
            },
        },
    },
];
