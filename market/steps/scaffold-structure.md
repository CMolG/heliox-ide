# scaffold-structure: Project Structure Scaffolding Step

A single, focused step that lays down the folder and file skeleton for a feature, module, or service before any business logic is written.

## What this step does

- Reads the existing project layout to match its conventions (language, framework, directory style).
- Creates the minimal set of files and folders the feature needs — entry points, module boundaries, and placeholders — with correct imports/exports wired up.
- Leaves the implementation bodies as clearly-marked stubs for later steps.

## Contract

- **Input:** a feature/module description and the target project.
- **Output:** created files/folders only (no business logic).
- **Suggested tools:** `list_directory`, `read_file`, `write_file`.

## Rules

- Mirror the surrounding project's structure and naming; do not impose a new architecture.
- Do not implement logic here — that belongs to a later step. Stubs must be obvious (`TODO`, `throw new Error('not implemented')`, etc.).
- Keep the skeleton minimal: only what the feature requires.
