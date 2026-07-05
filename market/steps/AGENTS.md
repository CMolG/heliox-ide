# Steps: Reusable Atomic Execution Units

Welcome to the `steps/` directory. In our Atoms Architecture, a **Step** is the smallest unit of agentic execution: a single, focused action an agent performs (scaffold, write tests, implement, review, refactor…).

If a **Flow** is the whole pipeline and a **Role** is the persona, a **Step** is one move.

---

## ⚙️ Core Characteristics

1. **Atomic & single-purpose.** Each step does exactly one job and produces one kind of artifact. "Scaffold and implement and test" is three steps, not one.
2. **Composable into Flows.** Steps are the building blocks a Flow (or the Meta-Agent) wires into a DAG. A predefined step is a reusable template a pipeline can drop in.
3. **Augmentable by Roles & Mods.** A step is executed by a Role and constrained by stacked Mods. The step's `.md` defines *what* to do; the Role defines *who* does it; the Mods define *how*.

---

## 🛠️ Anatomy of a Step

1. **The Instruction (`.md`):** A focused description of the action, its contract (input → output), and suggested tools.
2. **The Registry Entry:** Registered in `market/inventory.json` under `steps` so the IDE and the Meta-Agent can discover and place it.

**Example Registry Entry:**
```json
{
  "name": "write-failing-tests",
  "icon": "MdScience",
  "iconLibrary": "react-icons/md",
  "description": "Specifies desired behavior as executable tests that fail before any implementation exists (TDD red).",
  "tags": ["tdd", "tests", "red", "atomic"]
}
```
