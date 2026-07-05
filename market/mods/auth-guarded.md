# auth-guarded: Authentication & Authorization Enforcement Modifier

When this modifier is active, the agent applies a default-deny access model to every route, endpoint, and server action. No resource is accessible without an explicit, server-side authentication and authorization check. Trust nothing from the client.

## Rules

1. **Default deny on every entry point.** Every route, API endpoint, and server action must begin with an explicit auth check. The absence of an auth guard is a bug, not a choice. Middleware-level protection does not substitute for per-handler checks on sensitive operations.
2. **Authenticate before authorizing.** The server must first verify the identity of the caller (session token, JWT, OAuth 2.0 bearer token validated against the issuer) and only then evaluate their role or ownership. Skipping authentication and jumping to role checks is a rejection.
3. **Enforce RBAC and resource ownership server-side.** Permission decisions must be made on the server using the caller's verified identity and a role or ownership check (e.g., `user.id === resource.ownerId || user.roles.includes('admin')`). Client-controlled parameters such as `userId` in a request body must never be the sole basis for authorization.
4. **Protect sessions with `httpOnly`, `SameSite=Strict`, and rotation.** Session cookies must be `httpOnly` (inaccessible to JavaScript), `Secure` (HTTPS only), and `SameSite=Strict` or `Lax`. Session tokens must be rotated on privilege escalation and invalidated on logout.
5. **Apply CSRF protection to all state-changing requests.** Every POST, PUT, PATCH, and DELETE handler that accepts cookie-based sessions must validate a CSRF token (synchronizer token pattern or `SameSite=Strict` cookie as the sole mechanism only when explicitly justified).
6. **Never expose authorization decisions exclusively in the UI.** Hiding a button or link in the frontend is not access control. Server-side enforcement must independently reject unauthorized requests regardless of what the UI renders.
7. **Prevent IDOR by verifying resource ownership on every read and write.** Before returning or mutating any record, the server must confirm that the authenticated user owns or is explicitly permitted to access that specific resource ID. Trusting the client to send only IDs it owns is prohibited.

## Behavioral Overrides

- Before scaffolding any new route or server action, the agent must define the required role(s) or ownership condition and implement the guard before any business logic.
- Every API shape change is reviewed for authorization bypass: "Can a lower-privilege caller reach this data by changing a parameter?"
- This modifier is the web-route complement to the broader `security-hardened` umbrella mod. Both can be stacked — `auth-guarded` governs identity and access control specifically, while `security-hardened` covers the full attack surface. They reinforce each other without conflict.
- If a product requirement demands that a restricted resource be partially visible to unauthenticated users, the agent implements a scoped public projection and reports exactly which fields are exposed and why.
