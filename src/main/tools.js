import fs from 'node:fs';
import path from 'node:path';

/**
 * Capture the current terminal screen content.
 * Reads the last N lines written to the PTY by tracking output.
 */
export function captureScreen(terminalBuffer) {
    if (!terminalBuffer || terminalBuffer.length === 0) {
        return '(terminal buffer is empty)';
    }
    // Return the last 200 lines max
    const lines = terminalBuffer.slice(-200);
    return lines.join('\n');
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
        ptyProcess.write(text);
        return `Typed ${text.length} characters into terminal`;
    } catch (err) {
        return `Error typing to terminal: ${err.message}`;
    }
}

/**
 * Tool definitions for the OpenAI function calling API.
 */
export const toolDefinitions = [
    {
        type: 'function',
        function: {
            name: 'capture_screen',
            description:
                'Capture the current terminal screen content. Returns the text currently visible in the terminal buffer.',
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
            name: 'type_keyboard',
            description:
                'Type text into the terminal. This sends keystrokes to the terminal as if the user typed them. Use \\r for Enter key. For example, to run a command, send "ls -la\\r".',
            parameters: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description:
                            'The text to type into the terminal. Use \\r for Enter, \\t for Tab.',
                    },
                },
                required: ['text'],
            },
        },
    },
];
