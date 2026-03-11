import OpenAI from 'openai';
import { toolDefinitions, captureCurrentScreen, getHistoryOutput, fetchFile, typeKeyboard, runCommand } from './tools.js';

const SYSTEM_PROMPT = `You are MeowTerm AI 🐱, an intelligent terminal assistant embedded inside a terminal emulator.
You have access to the following tools:
- capture_current_screen: Read the current terminal output to understand what the user is seeing.
- get_history_output: Read the historical terminal output. Takes an optional 'lines' parameter (max 500).
- fetch_file: Read files or list directory contents from the filesystem.
- run_command: Safely execute a shell command. It checks if the terminal is ready at a prompt before running.
- type_keyboard: Type text or keystrokes directly into the terminal (e.g., when interacting with running TUI applications like vim/nano). Use <enter> for Enter key.

Guidelines:
- Be concise and helpful.
- When the you need to run a standard shell command, always use the run_command tool.
- When you need to interact with an already running application (like vim), use type_keyboard.
- When you need to understand the current state, use capture_current_screen or get_history_output first.
- When dealing with files and directories, use fetch_file to read them.
- Always explain what you're doing before executing actions.
- Use markdown formatting in your responses.`;
export class AIService {
    constructor() {
        this.client = null;
        this.conversationHistories = new Map(); // sessionId -> array of messages


        this.config = {};
        this.model = 'gpt-4o-mini';

        this.abortControllers = new Map(); // sessionId -> AbortController
    }

    setConfig(config) {
        this.config = config;
        this.model = config.model || 'gpt-4o-mini';

        this.timeout = config.timeout || 120000;
    }

    initialize() {
        const apiKey = this.config.apiKey;
        const baseURL = this.config.baseURL || 'https://api.openai.com/v1';

        if (!apiKey) {
            return {
                success: false,
                error: 'No API key found. Please set your apiKey in ~/.meowterm.json or via environment variables.',
            };
        }

        this.client = new OpenAI({ apiKey, baseURL });
        return { success: true };
    }

    /**
     * Send a message and run the tool loop until we get a text response.
     * Calls onToolCall for each tool execution and returns the final text.
     */
    async sendMessage(userMessage, { sessionId, ptyProcess, mainWindow, cwd, onToolCall }) {
        const debug = this.config.debug;
        if (debug) console.log(`[AI Debug] sendMessage: received user message for session ${sessionId}: "${userMessage.slice(0, 80)}..."`);

        if (!this.client) {
            if (debug) console.log(`[AI Debug] sendMessage: client not initialized, initializing...`);
            const init = this.initialize();
            if (!init.success) {
                if (debug) console.log(`[AI Debug] sendMessage: initialization failed: ${init.error}`);
                return { error: init.error };
            }
        }

        if (!this.conversationHistories.has(sessionId)) {
            this.conversationHistories.set(sessionId, []);
        }
        const history = this.conversationHistories.get(sessionId);

        history.push({
            role: 'user',
            content: userMessage,
        });

        const abortController = new AbortController();
        this.abortControllers.set(sessionId, abortController);

        try {
            let messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...history,
            ];

            // Tool loop: keep calling until we get a text-only response
            const MAX_ITERATIONS = 50;
            for (let i = 0; i < MAX_ITERATIONS; i++) {
                if (debug) console.log(`[AI Debug] sendMessage: === iteration ${i + 1}/${MAX_ITERATIONS} ===`);

                if (abortController.signal.aborted) {
                    if (debug) console.log(`[AI Debug] sendMessage: abort detected at loop start.`);
                    throw new Error('AbortError');
                }

                if (debug) console.log(`[AI Debug] sendMessage: sending LLM request (model: ${this.model}, messages: ${messages.length})...`);
                const requestPromise = this.client.chat.completions.create({
                    model: this.model,
                    messages,
                    tools: toolDefinitions,
                }, { signal: abortController.signal });

                let timeoutId;
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        if (debug) console.log(`[AI Debug] sendMessage: timeout reached (${this.timeout}ms). Aborting...`);
                        abortController.abort();
                        reject(new Error('TimeoutError'));
                    }, this.timeout);
                });

                let response;
                try {
                    response = await Promise.race([requestPromise, timeoutPromise]);
                    if (debug) console.log(`[AI Debug] sendMessage: LLM response received.`);
                } finally {
                    clearTimeout(timeoutId);
                }

                if (abortController.signal.aborted && !response) {
                    if (debug) console.log(`[AI Debug] sendMessage: abort detected after race, no response.`);
                    throw new Error('AbortError');
                }

                const choice = response.choices[0];
                const assistantMessage = choice.message;

                // Add assistant message to history
                messages.push(assistantMessage);

                // If no tool calls, we're done
                if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                    const content = assistantMessage.content || '';
                    if (debug) console.log(`[AI Debug] sendMessage: final text response received (${content.length} chars). Done.`);
                    history.push({
                        role: 'assistant',
                        content,
                    });
                    return { content };
                }

                if (debug) console.log(`[AI Debug] sendMessage: ${assistantMessage.tool_calls.length} tool call(s) requested.`);

                // Execute tool calls
                for (const toolCall of assistantMessage.tool_calls) {
                    const name = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    let result;

                    if (debug) console.log(`[AI Debug] sendMessage: executing tool "${name}" with args: ${JSON.stringify(args).slice(0, 200)}`);

                    if (onToolCall) {
                        onToolCall({ name, args });
                    }

                    switch (name) {
                        case 'capture_current_screen':
                            result = await captureCurrentScreen(mainWindow);
                            break;
                        case 'get_history_output':
                            result = await getHistoryOutput(mainWindow, args.lines);
                            break;
                        case 'fetch_file':
                            result = fetchFile(args.path, cwd);
                            break;
                        case 'type_keyboard':
                            result = typeKeyboard(ptyProcess, args.text);
                            break;
                        case 'run_command':
                            result = await runCommand(mainWindow, ptyProcess, args.command, abortController.signal, debug);
                            break;
                        default:
                            result = `Unknown tool: ${name}`;
                    }

                    const resultPreview = typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200);
                    if (debug) console.log(`[AI Debug] sendMessage: tool "${name}" returned (${typeof result === 'string' ? result.length : '?'} chars): ${resultPreview}`);

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: typeof result === 'string' ? result : JSON.stringify(result),
                    });
                }
            }

            if (debug) console.log(`[AI Debug] sendMessage: reached max iterations (${MAX_ITERATIONS}).`);
            return { content: '(Reached maximum tool call iterations)' };
        } catch (err) {
            if (err.name === 'AbortError' || err.message === 'AbortError') {
                if (debug) console.log(`[AI Debug] sendMessage: aborted by user.`);
                return { error: 'AbortError' };
            }
            if (err.message === 'TimeoutError') {
                if (debug) console.log(`[AI Debug] sendMessage: timed out after ${this.timeout / 1000}s.`);
                return { error: `Request timed out after ${this.timeout / 1000} seconds.` };
            }
            if (debug) console.log(`[AI Debug] sendMessage: error: ${err.message}`);
            return { error: `AI error: ${err.message}` };
        } finally {
            if (debug) console.log(`[AI Debug] sendMessage: cleanup done for session ${sessionId}.`);
            this.abortControllers.delete(sessionId);
        }
    }

    abortMessage(sessionId) {
        const controller = this.abortControllers.get(sessionId);
        if (controller) {
            controller.abort();
            this.abortControllers.delete(sessionId);
        }
    }

    clearHistory(sessionId) {
        if (sessionId) {
            this.conversationHistories.set(sessionId, []);
        } else {
            this.conversationHistories.clear();
        }
    }
}
