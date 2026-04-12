# Mods: Attachable Skills & Execution Constraints

Welcome to the `mods/` directory. In our Atoms Architecture, **Mods** (Modifiers) act as attachable skills, strict constraints, or specific rule-sets that alter how an AI agent operates during an interactive session.

If a **Role** is the "who" (the persona), a **Mod** dictates the "how" (the rules of engagement).

---

## ⚙️ Core Characteristics & Constraints

When designing or applying a Mod, you must strictly adhere to these architectural laws:

1.  **Stackability & Compatibility:** Unlike Roles (where only one can be active at a time), multiple Mods can be stacked onto a single session to create highly specialized behaviors (e.g., combining `test-driven`, `strict-linting`, and `zero-dependencies`). However, the IDE must validate that stacked Mods are **compatible** and do not contain conflicting systemic instructions.
2.  **Strictly Prohibited on Flows:** Mods **cannot** be attached to `flows`. Flows are rigid, pre-planned pipelines with their own hardcoded system constraints. Injecting a Mod into a Flow would cause prompt collisions, hallucination, or break the Flow's autonomous loop.
3.  **Enhancement of Roles:** Mods are designed to augment `roles`. For example, you can take the `frontend-engineer` Role and attach the `a11y-enforcer` Mod to guarantee that all generated UI components strictly pass WCAG AAA standards.

---

## 🖥️ The Wrapper Principle (UI Manifestation)

While Mods are fundamentally prompt-modifiers or logic gates on the backend, they must have a physical representation in the IDE interface.

Within an **IDE App** or **IDE Widget**, Mods are typically rendered as toggleable pills, checkboxes, or active-status badges attached to the current chat session. Because they live inside the IDE Wrapper, these UI elements must be highly responsive—compressing into simple icons when the wrapper is resized down to a widget, and expanding into descriptive toggles when in full-screen app mode.

---

## 🛠️ Anatomy of a Mod

To create a new Mod, you must define the following:

1.  **The System Injection (`.md` or `.txt`):** The specific, aggressive set of instructions that will be concatenated to the active Role's system prompt. This must be written as an absolute constraint (e.g., *"You must NEVER use third-party libraries..."*).
2.  **The Validation Logic (Optional):** If the Mod requires post-processing (e.g., actually running a linter over the output to enforce `strict-linting`), this script lives here.
3.  **The Registry Entry:** The Mod must be registered in the system's JSON inventory so the IDE apps know it exists and can render its icon in the configuration menus.

**Example Registry Entry:**
```json
{
  "name": "test-driven",
  "icon": "MdScience",
  "iconLibrary": "react-icons/md",
  "description": "Requires writing and presenting unit tests before implementing any core logic.",
  "tags": ["tdd", "testing", "unit-tests", "reliability"]
}