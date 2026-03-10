import OpenAI from 'openai';
import { toolDefinitions, captureScreen, fetchFile, typeKeyboard } from './tools.js';

const SYSTEM_PROMPT = `You are MeowTerm AI 🐱, an intelligent terminal assistant embedded inside a terminal emulator.

You have access to the following tools:
- capture_screen: Read the current terminal output to understand what the user is seeing.
- fetch_file: Read files or list directory contents from the filesystem.
- type_keyboard: Type commands or text directly into the terminal. Use \\r for Enter key.

Guidelines:
- Be concise and helpful.
- When the user asks you to run a command, use type_keyboard to type it followed by \\r.
- When you need to understand the current state, use capture_screen first.
- When dealing with files, use fetch_file to read them.
- Always explain what you're doing before executing actions.
- Use markdown formatting in your responses.`;

export class AIService {
    constructor() {
        this.client = null;
        this.conversationHistory = [];
        this.config = {};
        this.model = 'gpt-4o-mini';
    }

    setConfig(config) {
        this.config = config;
        this.model = config.model || 'gpt-4o-mini';
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
    async sendMessage(userMessage, { ptyProcess, mainWindow, cwd, onToolCall }) {
        if (!this.client) {
            const init = this.initialize();
            if (!init.success) {
                return { error: init.error };
            }
        }

        this.conversationHistory.push({
            role: 'user',
            content: userMessage,
        });

        try {
            let messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...this.conversationHistory,
            ];

            // Tool loop: keep calling until we get a text-only response
            const MAX_ITERATIONS = 50;
            for (let i = 0; i < MAX_ITERATIONS; i++) {
                const response = await this.client.chat.completions.create({
                    model: this.model,
                    messages,
                    tools: toolDefinitions,
                });

                const choice = response.choices[0];
                const assistantMessage = choice.message;

                // Add assistant message to history
                messages.push(assistantMessage);

                // If no tool calls, we're done
                if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                    const content = assistantMessage.content || '';
                    this.conversationHistory.push({
                        role: 'assistant',
                        content,
                    });
                    return { content };
                }

                // Execute tool calls
                for (const toolCall of assistantMessage.tool_calls) {
                    const name = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    let result;

                    if (onToolCall) {
                        onToolCall({ name, args });
                    }

                    switch (name) {
                        case 'capture_screen':
                            result = await captureScreen(mainWindow);
                            break;
                        case 'fetch_file':
                            result = fetchFile(args.path, cwd);
                            break;
                        case 'type_keyboard':
                            result = typeKeyboard(ptyProcess, args.text);
                            break;
                        default:
                            result = `Unknown tool: ${name}`;
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: typeof result === 'string' ? result : JSON.stringify(result),
                    });
                }
            }

            return { content: '(Reached maximum tool call iterations)' };
        } catch (err) {
            return { error: `AI error: ${err.message}` };
        }
    }

    clearHistory() {
        this.conversationHistory = [];
    }
}
