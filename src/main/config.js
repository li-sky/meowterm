import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_FILE = path.join(os.homedir(), '.meowterm.json');

const DEFAULT_CONFIG = {
    ai: {
        provider: 'openai', // Optional for now
        model: 'gpt-4o-mini',
        apiKey: '',
        baseURL: 'https://api.openai.com/v1',
    },
    terminal: {
        shell: process.platform === 'win32' ? 'pwsh.exe' : '/bin/bash',
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
        fontSize: 14,
    },
};

export function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const userConfig = JSON.parse(fileContent);

            // Deep merge (simple 2-level merge for ai/terminal)
            return {
                ai: { ...DEFAULT_CONFIG.ai, ...(userConfig.ai || {}) },
                terminal: { ...DEFAULT_CONFIG.terminal, ...(userConfig.terminal || {}) },
            };
        }
    } catch (error) {
        console.error(`Error loading config from ${CONFIG_FILE}:`, error);
    }

    // Create default if missing
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    } catch (e) {
        // ignore
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

// Allow env vars to override config file for AI settings
export function getMergedAiConfig(config) {
    return {
        model: process.env.MEOWTERM_MODEL || process.env.OPENAI_MODEL || config.ai.model,
        apiKey: process.env.MEOWTERM_API_KEY || process.env.OPENAI_API_KEY || config.ai.apiKey,
        baseURL: process.env.MEOWTERM_BASE_URL || process.env.OPENAI_BASE_URL || config.ai.baseURL,
    };
}
