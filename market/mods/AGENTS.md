# Mods: Attachable Skills & Execution Constraints

Welcome to the `mods/` directory. In our Atoms Architecture, **Mods** (Modifiers) act as attachable skills, strict constraints, or specific rule-sets that alter how an AI agent operates during an interactive session.

If a **Role** is the "who" (the persona), a **Mod** dictates the "how" (the rules of engagement).

---

## ⚙️ Core Characteristics & Constraints

When designing or applying a Mod, you must strictly adhere to these architectural laws:

1.  **Stackability & Compatibility:** Unlike Roles (where only one can be active at a time), multiple Mods can be stacked onto a single session to create highly specialized behaviors (e.g., combining `test-driven`, `strict-linting`, and `zero-dependencies`). However, the IDE must validate that stacked Mods are **compatible** and do not contain conflicting systemic instructions.
2.  **Strictly Prohibited on Flows:** Mods **cannot** be attached to `flows`. Flows are rigid, pre-planned pipelines with their own hardcoded system constraints. Injecting a Mod into a Flow would cause prompt collisions, hallucination, or break the Flow's autonomous loop.
3.  **Enhancement of Roles:** Mods are designed to augment `roles`. For example, you can take the `frontend-engineer` Role and attach the `a11y-enforcer` Mod to guarantee that all generated UI components strictly pass WCAG AAA standards.
4.  **Exclusive Groups (Mutual Exclusion):** A Mod may declare an `exclusiveGroup`. Mods sharing the same `exclusiveGroup` are **mutually incompatible** — only one can be active at a time. This is how a **Design System** is modeled: each design system is a Mod in the `design-system` exclusive group, so two design systems can never stack and blend their visual concepts. Design systems are *not* a separate market category; they are exclusive-group Mods. The loader auto-derives the incompatibility from the group, so you only set `exclusiveGroup`, not a hand-written `incompatibleWith` list.

---

## 🖥️ The Wrapper Principle (UI Manifestation)

While Mods are fundamentally prompt-modifiers or logic gates on the backend, they must have a physical representation in the IDE interface.

Within an **IDE App** or **IDE Widget**, Mods are typically rendered as toggleable pills, checkboxes, or active-status badges attached to the current chat session. Because they live inside the IDE Wrapper, these UI elements must be highly responsive—compressing into simple icons when the wrapper is resized down to a widget, and expanding into descriptive toggles when in full-screen app mode.

---

## 🛠️ Anatomy of a Mod

To create a new Mod, you must define the following:

1.  **The System Injection (`.md` or `.txt`):** The specific, aggressive set of instructions injected into the **system prompt** inside `<execution_constraints>`, concatenated after the active Role's persona. When stacked Mods conflict, precedence is deterministic: security > correctness > scope > style; a tie between two mods at the same precedence level is broken in favor of whichever mod is listed first.
2.  **The Validation Logic (Optional):** If the Mod requires post-processing (e.g., actually running a linter over the output to enforce `strict-linting`), this script lives here.
3.  **The Registry Entry:** The Mod must be registered in the system's JSON inventory so the IDE apps know it exists and can render its icon in the configuration menus.

---

## ⚡ Runtime Powers (declarative)

A Mod's registry entry may declare a `runtime` object — inert data the engine interprets against built-in capabilities, never arbitrary command execution:

- **`runtime.blockTools`:** Tool names stripped from the step's tool surface while the Mod is active (e.g. `dry-run` blocks `write_file` so "no code generation" is enforced by the runtime instead of trusted to the prompt).
- **`runtime.attachTools`:** Built-in toolsets granted while the Mod is active (e.g. `web-browser` for verification Mods like `seo-meta` or `web-vitals` to check their claims against the live page).
- **`runtime.contract`:** A `StepContract` fragment merged into the step's contract and verified by the guardrail engine, with corrective retries on failure (e.g. `test-driven` requiring a real test artifact).

The market **never** declares arbitrary command execution — only these three declarative, engine-interpreted powers.

---

## 🌐 Domains

A Mod (or Role) may declare `domains`: the areas where it is meaningful — `frontend`, `backend`, `web`, `data`, `infra`, or `universal` (role-agnostic, e.g. `self-review`). Domains are informational: the UI uses them to hint when a Mod is attached outside the active Role's domain, and the Meta-Agent uses them for auto-selection. They are never a hard enforcement boundary.

**Example Registry Entry:**
```json
{
  "name": "test-driven",
  "icon": "MdScience",
  "iconLibrary": "react-icons/md",
  "description": "Requires writing and presenting unit tests before implementing any core logic.",
  "tags": ["tdd", "testing", "unit-tests", "reliability"],
  "domains": ["universal"]
}
```