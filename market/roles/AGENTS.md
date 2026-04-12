# Roles: Agentic Personas & Domain Expertise

Welcome to the `roles/` directory. In our Atoms Architecture, **Roles** define the core identity, domain expertise, and conversational behavior of the AI during an interactive session.

If a **Mod** is the "how" (the rules) and a **Flow** is the "what" (the automated pipeline), a **Role** is the "who". It determines whether the user is talking to a hyper-focused Security Researcher, a pragmatic DevOps Engineer, or a visionary Design Engineer.

---

## ⚙️ Core Characteristics & Constraints

When designing or applying a Role, you must strictly adhere to these architectural laws:

1.  **Mutual Exclusivity (The "Single Persona" Rule):** An agentic session can only have **one** active Role at a time. Mixing Roles (e.g., trying to combine `frontend-engineer` and `backend-engineer` into a single hybrid prompt dynamically) leads to a "multiple personalities" disaster, diluting the AI's focus and degrading its output quality. If a full-stack approach is needed, a specific `full-stack-engineer` role must be created.
2.  **Synergy with Mods:** Roles are designed to be augmented by **Mods**. While the Role dictates the AI's general knowledge and tone, attached Mods enforce specific constraints (e.g., a `software-architect` Role combined with the `zero-dependencies` Mod).
3.  **Incompatible with Flows:** Roles are strictly for interactive, conversational sessions within `ide-apps` or `ide-widgets`. They cannot be applied to `flows`, as Flows are rigid, pre-planned autonomous pipelines that do not require conversational personas.

---

## 🖥️ The Wrapper Principle (UI Manifestation)

Within the IDE environment, the active Role must be immediately visually apparent to the user to set the correct cognitive context.

When a session is active inside an **IDE App** or **IDE Widget**, the Role should manifest in the UI wrapper. This could be through a specific avatar, a title in the chat header, or subtle theme changes. Because these UI elements live inside responsive wrappers, the visual representation of the Role must gracefully scale—from a simple icon (`MdDesignServices`) in a minimized desktop widget to a full profile header in the expanded app view.

---

## 🛠️ Anatomy of a Role

To create a new Role, you must define the following:

1.  **The Persona Prompt (`.md` or `.txt`):** The foundational system instruction that dictates the AI's Philosophy, Execution Guidelines, and Tone & Voice. This prompt tells the LLM exactly how to think and speak.
2.  **The Registry Entry:** The Role must be registered in the system's JSON inventory so the IDE apps can populate the persona selection menus and render the correct icons.

**Example Registry Entry:**
```json
{
  "name": "design-engineer",
  "icon": "MdDesignServices",
  "iconLibrary": "react-icons/md",
  "description": "Hybrid expert in UX/UI, frontend architecture, and Developer Experience (DX). Crafts minimalist, highly functional interfaces.",
  "tags": ["frontend", "ui", "ux", "dx", "design-system", "ide"]
}