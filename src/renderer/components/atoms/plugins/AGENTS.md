# IDE Plugins: Injectable Enhancements & Micro-Features

Welcome to the `ide/plugins/` directory. In our Atoms Architecture, **IDE Plugins** are the extensible micro-enhancers of the ecosystem.

Unlike an **IDE App** or an **IDE Widget**, a Plugin cannot exist on its own. It is a parasite—in a good way. Plugins are designed to attach themselves to specific "host" Apps or Widgets, injecting new behaviors, UI elements, or contextual actions into predefined slots without altering the host's core source code.

**Examples of IDE Plugins:**
* **Agentic Session Timer:** A plugin that injects a live clock into the header of the *Agent Chat* app, displaying the elapsed time of the current AI session.
* **Token Counter:** A micro-component that attaches to the status bar of the *File Editor* app, calculating and displaying the exact LLM token count of the currently active file.
* **Contextual AI Actions:** A plugin that hooks into the global right-click menu, adding options like "Explain Code" or "Generate Tests" when text is highlighted in any code viewer.

---

## ⚙️ Core Characteristics & Architectural Role

When building an IDE Plugin, you must adhere to the rules of host dependency:

1.  **Host Dependency:** Plugins cannot be launched from the desktop or dock. They must specify a `targetHost` (an App or Widget) and a `targetSlot` (e.g., `header-actions`, `status-bar`, `context-menu`). When the host app mounts, it checks the registry for active plugins and renders them in the appropriate slots.
2.  **Non-Destructive Execution:** A plugin must be entirely self-contained. If a plugin crashes, throws an error, or fails to load its data, it must fail silently or display a local error state. **A broken plugin must never crash its host App.**
3.  **State Sharing:** Plugins often need context from their host (e.g., the Token Counter needs to know what file the File Editor is currently viewing). Plugins should consume the host's exposed context or global state safely and read-only, unless explicitly granted mutation rights.

---

## 📐 The Wrapper Principle (Design Constraint)

**Adaptive Inheritance is Mandatory.** Because Plugins do not have their own Wrapper, they live entirely at the mercy of their host's Wrapper.

Your plugin must perfectly inherit the host's design tokens (colors, fonts, spacing). Furthermore, because the host App can be aggressively resized by the user, your plugin must be exceptionally responsive.
* If the *File Editor* is in full-screen mode, the Token Counter plugin might display: `[Icon] 4,200 Tokens (GPT-4)`.
* If the *File Editor* is squeezed into a tiny split-screen column, the plugin must elegantly collapse to just: `[Icon] 4.2k`.

---

## 🛠️ Anatomy of an IDE Plugin

To create a new IDE Plugin, you must provide the following:

1.  **The Injectable Component:** A lightweight React/Vue component designed to fit seamlessly into its intended slot.
2.  **The Lifecycle Hooks:** The logic that initializes the plugin when the host mounts and cleans up listeners (like time intervals for a clock) when the host unmounts.
3.  **The Registry Entry:** The Plugin must be registered in the system's JSON inventory. Crucially, this entry dictates *where* the plugin is allowed to render.

**Example Registry Entry:**
```json
{
  "name": "token-counter-plugin",
  "icon": "MdNumbers",
  "iconLibrary": "react-icons/md",
  "description": "Injects a live token counter into the status bar of code viewing applications.",
  "type": "ide-plugin",
  "targetHost": ["file-editor", "diff-viewer"],
  "targetSlot": "bottom-status-bar"
}