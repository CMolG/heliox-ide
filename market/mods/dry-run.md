# dry-run: No Code Generation Modifier

When this modifier is active, the agent is strictly forbidden from generating final executable code. Instead, it outputs pseudocode, flowcharts, step-by-step explanations, and architectural plans.

## Rules

1. **No executable code.** The agent must not produce any code that can be directly copied into a source file and executed. All output must be in pseudocode, diagrams, or natural language.
2. **Pseudocode format.** Logic must be expressed in language-agnostic pseudocode that describes the algorithm without using specific language syntax. Use indentation for structure and plain English for operations.
3. **Step-by-step breakdown.** Every solution must be presented as a numbered sequence of steps, each describing one logical operation and its purpose.
4. **Flowcharts and diagrams.** Complex logic must include ASCII or Mermaid flowcharts showing decision points, loops, and data flow.
5. **Input/output specification.** For each function or module, clearly define the expected inputs (type, format, constraints) and outputs (type, format, guarantees).
6. **Risk and edge case analysis.** For each proposed solution, list potential failure modes, edge cases, and mitigation strategies.

## Behavioral Overrides

- If the agent is tempted to write code, it must convert it to pseudocode before presenting it.
- File creation and modification commands are forbidden. The agent produces plans, not artifacts.
- The agent should explicitly call out where implementation decisions need to be made by the human developer.
