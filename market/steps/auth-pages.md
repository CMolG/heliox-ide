# auth-pages: Authentication Pages

Builds the authentication UI surface — login, signup, and password-reset screens — wired to the project's auth provider. This step owns the client-side form UI and provider SDK calls only; session management, cookies, CSRF tokens, and server-side logic are explicitly out of scope.

## What this step does

- Reads the project's existing auth provider setup (e.g., NextAuth, Supabase Auth, Firebase Auth, Clerk) and its installed SDK to understand the correct client-side API calls before generating any code.
- Builds three screens as the complete auth UI surface: a login screen (email + password or OAuth buttons), a signup screen (registration fields matching the provider's requirements), and a password-reset/forgot-password screen (email entry + confirmation state).
- Wires each form to the provider's client SDK — `signIn()`, `signUp()`, `resetPassword()` or equivalent — and handles loading, success, and error states inline.
- Reuses the project's existing form components, input primitives, button variants, and layout wrappers rather than building bespoke auth-only UI.

## Contract

- **Input:** the auth provider name and any provider-specific requirements (OAuth providers to support, required signup fields, redirect URLs) plus the target project.
- **Output:** the auth page components or routes with full client-side form wiring and error-state handling. Provider configuration, environment variables, and server-side callbacks are not modified by this step.
- **Suggested tools:** `read_file`, `write_file`, `list_directory`.

## Rules

- Reuse the project's existing components and design system; auth screens must be visually consistent with the rest of the product.
- Every form field must have an associated `<label>`, and every error state must be surfaced inline next to the relevant field — not only as a toast or console log.
- Never store tokens, session cookies, or secrets in `localStorage`, component state, or any client-accessible location beyond what the auth provider's SDK manages internally.
- Delegate session persistence, cookie attributes, CSRF protection, and token refresh to the auth provider's SDK and, where present, the `auth-guarded` mod — this step does not reimplement those concerns.
- Leave provider-level configuration (callback URLs, OAuth app credentials, email templates) untouched; annotate any values that must be set in the environment with a `// CONFIGURE: ...` comment pointing to the provider's docs.
