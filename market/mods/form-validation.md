# form-validation: Accessible Form Validation Modifier

When this modifier is active, the agent treats every form as both a trust boundary and an accessibility surface. Client-side validation is a UX courtesy; server-side validation is mandatory. No data reaches persistence or a downstream service without passing a typed schema check.

## Rules

1. **Validate on the client AND the server with a single shared schema.** Define one typed schema (e.g., Zod, Yup, Valibot) and use it for both client-side feedback and server-side enforcement. Duplicating validation logic in two separate implementations is prohibited; the schema is the single source of truth.
2. **Associate every error message with its input via `aria-describedby` and `aria-invalid`.** When a field fails validation, set `aria-invalid="true"` on the input and point `aria-describedby` to the error message element's `id`. Screen readers must announce the error when the field receives focus.
3. **Never rely on color alone to communicate errors.** Error states must use at least two distinct visual signals: color change plus an icon, border change, or explicit label text. Users with color vision deficiency must be able to identify invalid fields without perceiving red.
4. **Use native HTML constraints and input types first.** Leverage `required`, `minlength`, `maxlength`, `pattern`, `min`, `max`, and semantic `type` attributes (`type="email"`, `type="tel"`, `type="url"`) before layering custom JavaScript validation on top.
5. **Validate on blur per field; summarize all errors on submit.** Individual field errors must surface when the user leaves a field (`blur` event) after an initial interaction. On form submit, collect all errors, render a summary above the form linked to each invalid field, and move keyboard focus to the summary element.
6. **Debounce async validation to avoid UI thrashing.** Fields that trigger server-round-trips (username availability, address lookup) must debounce the request by at least 300 ms and show a loading indicator. The field must not be marked invalid until the async check resolves.
7. **Never submit unvalidated data.** The form submit handler must re-run full schema validation synchronously before sending any request. If validation fails at this point (e.g., programmatic submit, race condition), the submission is aborted and errors are surfaced.

## Behavioral Overrides

- Before implementing any form, the agent must define the Zod (or equivalent) schema for the entire shape of submitted data, including optional fields and their permissible values.
- Every error message is reviewed for clarity and tone: messages must name the field, state what is wrong, and tell the user how to fix it — generic "Invalid input" messages are rejected.
- If a design specifies error styling that relies solely on color, the agent flags the accessibility failure and proposes a compliant alternative before implementing.
- If client validation and server validation produce conflicting results (e.g., server rejects a value the client schema accepts), the agent resolves the schema discrepancy and reports the root cause rather than patching one side in isolation.
