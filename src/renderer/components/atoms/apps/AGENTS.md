# IDE Apps: Core Applications & Interfaces

Welcome to the `ide/apps/` directory. In our Atoms Architecture, **IDE Apps** are the heavy-duty, primary graphical interfaces of the ecosystem.

If Agentic Atoms (`flows`, `roles`, `mods`) are the brains and rules of the IDE, **IDE Apps** are the body. They are the central workspaces where users interact with the codebase, manage tasks, and communicate with the AI.

**Examples of IDE Apps:**
* **Agent Chat:** A conversational interface where a user interacts with a specific `role` and active `mods`.
* **Kanban Board:** A visual project management app that reads, edits, and manages the Agentic Cards (`.md` files) inside the `.backlog/` folder.
* **File Editor:** A robust, Monaco-style or VS Code-like text editor for manually reviewing and editing source code.

---

## ⚙️ Core Characteristics & Architectural Role

As the core elements of the visual hierarchy, IDE Apps have unique privileges and responsibilities:

1.  **Hosting Agentic Atoms:** IDE Apps act as the host environment for interactive AI sessions. An app (like the Agent Chat) can accept the attachment of a **Role** (e.g., `software-architect`) and multiple **Mods** (e.g., `strict-linting`, `zero-dependencies`) to define the behavior of the current session.
2.  **Extensibility via Plugins:** Apps must be built with injection points. They are designed to accept `ide-plugins` that add new behaviors or UI elements without modifying the App's core code (e.g., a plugin that adds a "Explain Code" option to the File Editor's right-click contextual menu).
3.  **Spawning Widgets:** Apps can spawn or be reduced into `ide-widgets`. For instance, the heavy Kanban App might spawn a small "Current Task" widget that stays pinned to the desktop.

---

## 📐 The Wrapper Principle (Design Constraint)

**Total Responsiveness is Mandatory.** Every IDE App is rendered inside an isolated **Wrapper**—similar to a Figma frame or a resizable window in a desktop OS.

Because the IDE allows users to dock, resize, split-screen, and float these wrappers across their workspace, the internal UI of your App must be built with strict fluid/responsive design principles.
* **Full Screen:** The Kanban board shows all columns and detailed card data.
* **Split Screen:** The board condenses padding and hides secondary metadata.
* **Floating Panel:** The board converts into a single-column scrollable list.

Never hardcode fixed widths (`w-[800px]`) that will break when the wrapper is resized by the user.

---

## 🛠️ Anatomy of an IDE App

To create a new IDE App, you must provide the following:

1.  **The Component Tree (React/Vue/etc.):** The actual UI implementation, built cleanly and modularly, respecting the IDE's global Design System.
2.  **State Management & Logic:** The local state required to run the app, including the logic to read/write to the file system (e.g., reading `.backlog/` files for the Kanban app) or communicate with the Agentic Atoms.
3.  **Plugin Hooks (Slots/APIs):** Exposed areas where `ide-plugins` can safely inject their UI (tabs, context menus, header actions).
4.  **The Registry Entry:** The App must be registered in the system's JSON inventory so the core IDE wrapper knows it exists, can render its launch icon, and manage its lifecycle.

**Example Registry Entry:**
```json
{
  "name": "kanban-board",
  "icon": "MdViewKanban",
  "iconLibrary": "react-icons/md",
  "description": "Visualizes the .backlog/ directory as an interactive Kanban board for Agentic Cards.",
  "type": "ide-app"
}