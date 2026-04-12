# Flows: Autonomous Execution Pipelines

Welcome to the `flows/` directory. In our Atoms Architecture, **Flows** are the heavy-duty engines of the IDE.

A Flow is an independent, autonomous agentic pipeline designed to execute a specific, pre-planned sequence of actions. Think of them as highly intelligent macros, CI/CD scripts, or background workers that operate on the codebase.

---

## ⚙️ Core Characteristics & Constraints

When building or modifying a Flow, you must strictly adhere to these architectural rules:

1.  **Concrete Behavior:** Unlike standard chat sessions that rely on conversational prompting, Flows have a rigid, hardcoded purpose (e.g., "reduce code bloat" or "migrate tests to Karate"). They do not wait for human conversational input once initiated.
2.  **No Mod Attachments:** Because a Flow's behavior and system constraints are already strictly defined in its prompt, **Mods cannot be attached to Flows**. Injecting a Mod (like `strict-linting`) into a Flow that already has its own execution rules would cause prompt collision and unpredictable behavior.
3.  **The Wrapper Principle (UI):** Even though Flows are primarily backend logic, their execution state must be visualized in the IDE. Whether it renders as a progress tracker, a terminal output, or a Kanban board reader, the Flow's UI component must be completely fluid and responsive, capable of running inside an IDE Wrapper (docked, floating, or minimized).

---

## 🔄 Flow Execution Types

Flows in this directory generally fall into two distinct execution models based on their `cost` and `tags` in the system registry:

### 1. Finite Flows (`cost: finite` / `single-shot`)
These Flows act as surgical execution agents. They are triggered by a specific task (usually an Agentic Card in the `.backlog/` folder), execute the required logic, update the task status, and **terminate**.
* **Examples:** `auto-optimizer-finite`, `auto-reducer-finite`, `auto-visual-fixer-finite`, `auto-feature-engineer-finite`.

### 2. Infinite Flows (`cost: infinite` / `loop`)
Also known as "Karpathy Loops", these Flows run continuously in the background. They do not terminate after a single task. Instead, they constantly scan the project, manage queues, or sequentially consume backlogs until explicitly stopped by the user.
* **Examples:** `auto-architect` (The Brain), `auto-feature-engineer` (The Assembly Line).

---

## 🛠️ Anatomy of a Flow

To create a new Flow, you must provide three core elements:

1.  **The System Prompt (`.md` or `.txt`):** The unbreakable instructions that define the Flow's setup, constraints (What you CANNOT do), execution loop, and output formatting.
2.  **The Execution Logic:** The script or orchestrator wrapper that actually runs the LLM loop, handles file system reads/writes, and parses the YAML/TSV logs.
3.  **The Registry Entry:** The Flow must be registered in the system's JSON inventory so the IDE knows how to route tasks to it and render its icon.

**Example Registry Entry:**
```json
{
  "name": "your-new-flow",
  "betterOn": "claude-opus-4.6",
  "recommendedComplexity": "high",
  "cost": "infinite", 
  "icon": "MdBuild",
  "iconLibrary": "react-icons/md",
  "description": "Brief description of the pipeline's purpose.",
  "tags": ["pipeline", "loop", "custom"]
}