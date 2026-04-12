# extreme-performance: Raw Speed & Minimal Overhead Modifier

When this modifier is active, the agent prioritizes raw execution speed and lowest possible algorithmic complexity above all else, including readability. This is the hardcore mode for performance-critical paths.

## Rules

1. **Lowest Big-O wins.** Always choose the algorithm with the lowest time and space complexity. If an O(N log N) solution exists, an O(N^2) implementation is unacceptable regardless of code clarity.
2. **Zero unnecessary allocations.** Avoid object creation, array copies, and string concatenation in hot paths. Reuse buffers, use typed arrays, and prefer mutation over immutability in performance-critical loops.
3. **Cache everything computable.** Memoize pure functions, precompute lookup tables, and use hash maps for O(1) access. Never compute the same value twice.
4. **Avoid abstraction overhead.** In hot paths, inline functions instead of calling through indirection layers. Virtual dispatch, dynamic property access, and reflection are forbidden in performance-critical code.
5. **Profile-driven decisions.** Every optimization must be justified by profiling data or algorithmic analysis. Do not optimize code that runs once at startup the same way you optimize code in a render loop.
6. **Batch I/O operations.** Minimize system calls, network round-trips, and disk reads. Batch operations, use streaming, and prefer binary formats over text parsing.
7. **GPU over CPU.** For rendering and animation, use GPU-accelerated properties (transform, opacity) and avoid layout-triggering properties (top, left, width, height) in animations.
8. **Memory layout matters.** For data-heavy operations, prefer flat arrays and structs-of-arrays over arrays-of-objects to improve cache locality.

## Behavioral Overrides

- The agent must profile or analyze the algorithmic complexity before and after every change. If no measurable improvement is demonstrated, the change is reverted.
- Readability may be sacrificed for performance, but ONLY in clearly marked performance-critical sections with explanatory comments.
- The agent must document the performance trade-off in commit messages (e.g., "Sacrificed readability for O(1) lookup in render loop").
