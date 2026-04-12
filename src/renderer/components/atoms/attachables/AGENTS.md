
# Attachables: Interlocking UI Components for Agentic Atoms

Welcome to the `ui/attachables/` directory. In our Atoms Architecture, **Attachables** are the modular, visual puzzle pieces that represent our Agentic Atoms (Roles, Mods, and Flows).

These components abandon traditional UI forms (like checkboxes or dropdowns) in favor of a **physical, interlocking paradigm**. Users do not "toggle" a Mod; they physically "snap" a Mod onto a core component, like attaching a Lego brick to a baseplate.

----------

## 📐 The Universal Wrapper & Socket Principle

Before building any Attachable component, you must adhere to the **Socket Principle** within the responsive IDE Wrapper.

-   **Interlocking UI:** Attachables must be designed with visual affordances that suggest they connect to something else (e.g., jigsaw tabs, magnetic docking zones, or connected node graphs).

-   **Fluidity:** The connected cluster of blocks must use flexbox or grid to wrap and adapt. If a user snaps 5 Mods onto a Role, the resulting "molecule" must scale gracefully when the wrapper is resized.

-   **Iconography:** All Attachables pull their visual identity (`react-icons/md`) and color-coding from the registry to make their function instantly recognizable at a glance.


----------

## 🧩 Component Categories & The Puzzle UX

The UI must actively enforce the backend architectural constraints through physics-like interactions. Here is how the three types of Attachables must be implemented:

### 1. Role Attachables (The Core Socket)

Roles dictate _who_ the AI is. Because an agentic session can only have **one** active Role at a time, the UI must treat the Role as the primary "Core Socket" or "Head" piece.

-   **The Visual Metaphor:** A central node or primary Lego block.

-   **Connection Logic:** There is only ONE Role slot available in an IDE App's agentic session. If a user drags a new Role into the slot, it physically ejects and replaces the previous Role.

-   **Visual Dominance:** The active Role dictates the color theme and icon of the central socket, dominating the cognitive context of the chat session.


### 2. Mod Attachables (The Snap-On Upgrades)

Mods dictate _how_ the AI behaves via strict rules. Because Mods are **stackable**, the UI must treat them as interlocking accessory blocks that physically snap onto the Role or the input bar.

-   **The Visual Metaphor:** Armor plating, weapon attachments, or jigsaw puzzle edge pieces connecting to the Core Socket.

-   **Connection Logic:** Users drag and drop (or click to snap) Mod blocks onto the active Role cluster. As they are attached, they visually link together to form a chain or a surrounding ring.

-   **Constraint Enforcement (Physical Rejection):** * If a user tries to snap a Mod that is incompatible with the existing cluster, the UI should visually reject the connection (e.g., the pieces repel each other, or the socket turns red).

    -   If the user is viewing a **Flow**, the UI must show that the Flow has _no available sockets_—making it physically impossible to attach a Mod block to it.


### 3. Flow Attachables (The Sealed Engine)

Flows are the _what_—autonomous, pre-planned execution pipelines. Since they do not require conversational prompting and cannot accept Mods, their UI is a completely different physical object.

-   **The Visual Metaphor:** A sealed, heavy-duty engine block or conveyor belt. It has power controls, but no exposed sockets for customization.

-   **Execution Controls:** Provide clear physical-feeling buttons (Start, Pause, Terminate) built directly into the engine block.

-   **State Visualization:** * _Finite Flows:_ Render as a single-shot progress bar or a machine processing a single item.

    -   _Infinite Flows:_ Render as a continuous looped track, a terminal readout, or a Kanban card feeder.


----------

## 📊 Summary of Interlocking Constraints

**Component Type**

**Visual Metaphor**

**Connection Logic**

**Backend Constraint Enforced**

**Role**

Core Socket / Head Block

Replaces previous block; only 1 fits.

Only 1 active per session.

**Mod**

Snap-On Jigsaw Piece

Clicks into the Role cluster; stacks.

Stackable; **Rejected** by Flows.

**Flow**

Sealed Engine Block

Standalone; has no connection sockets.

Rigid pipelines; No Mods allowed.

----------

## 🛠️ Reading the Registry

All Attachable UI components must be completely data-driven. Do not hardcode names or socket shapes. Your components should fetch the available Atoms from the global JSON registry and map over them to generate the draggable puzzle pieces.

**Expected Registry Data Mapping:**

-   `iconLibrary` + `icon` → Maps to the block's central emblem.

-   `name` → Display label (parsed from kebab-case to Title Case) engraved on the block.

-   `tags` → Used to determine compatibility logic (which sockets accept which tabs).