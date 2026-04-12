# Agentic IDE: The Atoms Architecture

**Atoms** are the fundamental, indivisible building blocks of our Agentic IDE. Every component, behavior, and interface in the system is an Atom.

To maintain a scalable and modular ecosystem, no two Atoms are exactly alike. They are divided into two primary categories: **Agentic Atoms** (which define behavior and intelligence) and **IDE Atoms** (which define the graphical interface and are direct children of the core IDE).

---

## 🧠 1. Agentic Atoms (The Intelligence)

These atoms control *how* the AI behaves, executes tasks, and interacts with the user.

* **Flows (`flows`):** Independent, autonomous execution pipelines. Think of them as complex macros or executable scripts. Because Flows have highly specific, hardcoded behaviors (like the Karpathy infinite loop), they are rigid and **cannot** have Mods attached to them.
* **Roles (`roles`):** The "persona" or domain expertise of an agentic session (e.g., `frontend-engineer`, `security-researcher`). **Constraint:** Roles are mutually exclusive. An agentic session can only have *one* Role at a time to prevent conflicting behaviors (avoiding the "multiple personalities" disaster).
* **Mods (`mods`):** Attachable "skills" or strict utilities (e.g., `strict-linting`, `zero-dependencies`). Mods can be stacked onto an interactive agentic session to enforce constraints, provided the selected Mods are compatible with one another. *Note: Mods cannot be attached to Flows.*

---

## 🖥️ 2. IDE Atoms (The Interface)

These atoms dictate how tools are presented to the user. **All IDE Atoms are direct children of the core IDE wrapper.**

* **IDE Apps (`ide-apps`):** The core, heavy-duty functional elements of the IDE. Apps act as the main orchestrators: they can host their own complex interfaces, accept the injection of `ide-plugins`, spawn `ide-widgets`, and attach Agentic Atoms (Roles and Mods) to power their internal logic.
* **IDE Widgets (`ide-widgets`):** "Tinified", highly focused versions of `ide-apps`. They act as desktop-level shortcuts or quick-preview windows that users can pin to their workspace for immediate access without opening the full application.
* **IDE Plugins (`ide-plugins`):** Injectable behavior modifiers. Plugins do not live on their own; they exist to extend the capabilities of `ide-apps` or `ide-widgets`. Examples include adding a new tab to an app's sidebar or injecting a new action into the global right-click contextual menu.

---

## 📐 The Wrapper Principle (Design Constraint)

**Total Responsiveness is Mandatory.** Every Atom that renders a UI (Flows, Apps, and Widgets) is designed to run inside an isolated **Wrapper**—similar to a Figma frame or a resizable Windows OS window.

Because the IDE allows users to dock, resize, and float these wrappers across their workspace, the internal UI of these atoms must be built with strict fluid/responsive design principles. They must gracefully adapt from a tiny floating widget to a full-screen application view without breaking the layout or cognitive ergonomics.