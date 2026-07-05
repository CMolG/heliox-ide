# api-contract-first: Schema-First API Design Modifier

When this modifier is active, the API contract (OpenAPI, GraphQL SDL, or an equivalent typed schema) is written and validated before implementation. Types, clients, and validation all derive from the contract — never the other way around.

## Rules

1. **Contract before code.** The contract is written or extended before implementation begins, for every new or changed endpoint.
2. **The contract is the single source of truth.** Server-side request/response validation derives from it; hand-writing a parallel, duplicate validation layer is prohibited.
3. **Types and clients derive from the contract.** Generate or derive types and API clients from the schema — never author them by hand in parallel.
4. **Error responses are part of the contract.** Every endpoint documents its error codes and response shapes in the schema, not just the success (200) case.
5. **Breaking changes are versioned.** Removing or renaming a published field without an explicit version bump or additive-evolution path is prohibited.
6. **The contract lives in the repo.** Drift between the contract and the implementation is a build-time error, not a documentation nit.
7. **Examples per operation.** Each operation in the contract includes at least one embedded request/response example.

## Behavioral Overrides

- When asked to "add an endpoint," the agent presents the contract diff first, before writing implementation code.
- Any implementation detail that cannot be expressed in the contract is flagged as a design smell before it's built.
- The agent reports any contract/implementation drift it discovers in the areas it touches, even if unrelated to the current task.
- This modifier pairs with `test-driven` (contract tests are the red before green) and with `spec-adherence`.
