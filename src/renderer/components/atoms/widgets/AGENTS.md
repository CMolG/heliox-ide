# IDE Widgets: Desktop Accessories & Mini-Apps

Welcome to the `ide/widgets/` directory. In our Atoms Architecture, **IDE Widgets** are the "tinified", lightweight visual components of the ecosystem.

If an **IDE App** is your heavy-duty workspace, an **IDE Widget** is a quick-glance accessory. Widgets act as desktop-level shortcuts, floating tools, or reduced-view monitors that users can pin to their IDE workspace for immediate access without opening a full application.

**Examples of IDE Widgets:**
* **Agentic Runners Overview:** A tiny dashboard showing the live status, current task, and resource consumption of active `flows` (like the `auto-optimizer` running in the background).
* **Statistics Gamification:** A mini-game or tamagotchi-like widget that levels up or shows animations based on how many lines of technical debt the `auto-reducer` has cleared.
* **Productivity Tools:** Standalone, focused utilities like a Pomodoro Timer, a World Clock, or a quick-note scratchpad.

---

## ⚙️ Core Characteristics & Architectural Role

Widgets are designed for speed and visibility. When building a Widget, you must adhere to these rules:

1.  **Glanceability over Depth:** Widgets should prioritize data visualization and quick actions (play, pause, stop, open full app). Deep, complex interactions should be offloaded to the parent **IDE App**.
2.  **Parent-Child Relationship (Optional):** Many widgets act as "mini-views" of larger apps. For example, clicking "Expand" on the *Agentic Runners Overview* widget should launch the full *Runner Manager App*. However, simple widgets (like a Clock) can exist standalone without a parent app.
3.  **Background Efficiency:** Because users will leave multiple widgets pinned to their desktop simultaneously, they must be heavily optimized. Use debouncing for state updates and avoid heavy DOM repaints so they do not drain the IDE's performance.

---

## 📐 The Wrapper Principle (Design Constraint)

**Extreme Responsiveness is Mandatory.** Widgets are the ultimate test of the IDE Wrapper.

Users will drag widgets around the screen, pin them to the corners, or dock them in narrow sidebars. Your widget must be built with fluid CSS (Flexbox/Grid, container queries, relative units) to look perfect in highly constrained dimensions (e.g., 200x200px or a thin 150px vertical strip).

If a widget's wrapper is resized too small to display its content, it should gracefully degrade—hiding text labels and leaving only icons, or morphing into a minimalist progress bar.

---

## 🛠️ Anatomy of an IDE Widget

To create a new IDE Widget, you must provide the following:

1.  **The Component Tree:** A highly optimized, tiny React/Vue component.
2.  **Global Store Subscriptions:** Widgets rarely manage complex local state. Instead, they subscribe to global state managers or event emitters (e.g., listening to the global event bus to update the Pomodoro timer or fetching the active `flows` status).
3.  **The Registry Entry:** The Widget must be registered in the system's JSON inventory so the IDE knows it can be spawned, dragged onto the desktop, and saved in the user's workspace layout layout.

**Example Registry Entry:**
```json
{
  "name": "runners-overview-widget",
  "icon": "MdSpeed",
  "iconLibrary": "react-icons/md",
  "description": "A compact desktop widget displaying the live status of all active infinite flows.",
  "type": "ide-widget",
  "defaultSize": { "width": 250, "height": 300 }
}