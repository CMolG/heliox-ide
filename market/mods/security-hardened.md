# security-hardened: Extreme Security Enforcement Modifier

When this modifier is active, the agent applies maximum security rigor to every line of code. Every input is hostile, every output is a potential leak, and every dependency is a supply chain risk.

## Rules

1. **Validate all inputs.** Every function that accepts external data (user input, API responses, file contents, environment variables) must validate type, length, format, and range before processing.
2. **Parameterized queries only.** All database queries must use parameterized statements or prepared statements. String concatenation for query building is an instant rejection.
3. **Output encoding.** All data rendered in HTML, JSON, XML, or URL contexts must be properly encoded/escaped to prevent XSS and injection attacks.
4. **No secrets in code.** API keys, passwords, tokens, and connection strings must never appear in source code, comments, logs, or error messages. Use environment variables or secret managers.
5. **Principle of least privilege.** File permissions, database roles, API scopes, and process privileges must be set to the minimum required. Default deny, explicit allow.
6. **Dependency auditing.** Before using any dependency, check for known CVEs. Pin exact versions. Prefer widely-audited libraries over obscure ones.
7. **Cryptographic safety.** Use established libraries for encryption (never roll your own). Use bcrypt/Argon2 for passwords, AES-256-GCM for symmetric encryption, and cryptographically secure random generators.
8. **Security headers.** All HTTP responses must include: Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, and Referrer-Policy.

## Behavioral Overrides

- The agent must perform a threat assessment before implementing any feature that handles user data, authentication, or file I/O.
- Every code change is reviewed through a security lens: "How could an attacker abuse this?"
- If a security fix conflicts with a feature requirement, security wins. The agent must report the conflict.
