# MeowTerm 🐱

MeowTerm is an AI-powered terminal emulator built with Electron, xterm.js, and Vite. It seamlessly integrates a powerful terminal environment with a context-aware AI chat assistant to boost your productivity. Designed with a sleek, customizable interface and robust functionality, MeowTerm brings intelligent automation directly to your command line.

## 🚀 Features

### **Intelligent Terminal Assistant**
MeowTerm embeds an AI directly alongside your terminal. The assistant uses advanced tools to understand what you're doing and take action on your behalf:
- **Screen & History Analysis**: The AI can read the visible terminal screen and fetch command history (up to 500 lines) to provide highly contextual answers and solutions based on your recent workflow.
- **Smart Execution**: Safely run shell commands directly from the chat. MeowTerm guarantees that standard shell commands are executed only when the terminal is idle at a prompt, avoiding disastrous input collisions.
- **Interactive TUI Support**: Interact with running TUI applications (like `vim`, `nano`, or interactive prompts) using the `type_keyboard` tool, sending keystrokes and control characters (e.g., `<enter>`, `<tab>`, `<esc>`).
- **File System Inspection**: Fetch and read files or list directory contents straight from the chat, allowing the AI to debug issues or explain codebase logic.
- **Engaging UI Elements**: Real-time tools execution indicators and a progressive, fluid typewriter animation for AI text responses.

### **Robust Terminal Core**
- Powered by `node-pty` and `@xterm/xterm`, delivering reliable terminal execution performance.
- Automatically launches `pwsh.exe` or `cmd.exe` on Windows, and defaults to `bash` or `zsh` on macOS/Linux. Alternatively, you can override the target shell via configuration.
- Support for auto-resizing (`@xterm/addon-fit`) and clickable web links (`@xterm/addon-web-links`).

### **Highly Customizable Appearance**
- Out of the box, it features a modern, dark-themed scheme with distinct color mappings and custom window dimensions.
- A toggleable and seamlessly resizable chat panel with drag-to-resize functionality to maximize your terminal workspace when needed.
- Load custom setup from `~/.meowterm.json`—including customized `apiKey` sources, base AI models, font families, font sizes, and specific shell environments.

## 🤝 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16.x or newer is recommended)
- Configured `.meowterm.json` file in your system's Home directory containing your API details and optional visual preferences.

### Installation & Development
Clone the repository, install dependencies, and run the app:

```bash
# Install required dependencies
npm install

# Start the application in development mode
npm start
```

### Packaging & Release
To produce a standalone application or installer specific to your OS:

```bash
# Package the application for distribution
npm run package

# Build installer executables (like .exe for Windows)
npm run make
```

## 🛠 Overview of the Architecture

- `package.json`: Manages the Electron Forge pipeline and external dependencies (`@xterm/xterm`, `node-pty`, `openai`).
- `src/main.js`: Main process entry point. Defines window properties, instantiates the PTY pseudo-terminal using the detected or configured shell, and establishes the IPC pipeline bridging the AI service context and PTY callbacks.
- `src/main/ai-service.js` & `src/main/tools.js`: Manages OpenAI chat context, and interprets the system tool loop—validating executing actions like `capture_current_screen`, `fetch_file`, `type_keyboard`, and `run_command` in your local environment.
- `src/renderer.js`: Orchestrates UI logic, rendering the customized `xterm` instance, dynamically refreshing DOM styles from settings, and managing bidirectional user interaction (chat messages matching user/assistant roles).
- `src/index.css`: Vanilla CSS responsible for the application's clean design, chat scrolling mechanics, and markdown message rendering layers.

## 📝 Configuration

You can customize MeowTerm by creating a `.meowterm.json` file in your home directory:

```json
{
  "apiKey": "YOUR_OPENAI_API_KEY",
  "model": "gpt-4o-mini",
  "baseURL": "https://api.openai.com/v1",
  "terminal": {
    "shell": "pwsh.exe",
    "fontFamily": "JetBrains Mono",
    "fontSize": 14
  },
  "chat": {
    "fontFamily": "Inter",
    "fontSize": 13
  }
}
```

## 📄 License

This project is licensed under the MIT License. Created by Sky Li.
