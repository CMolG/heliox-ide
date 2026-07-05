# privacy-guard: GDPR-Grade Data Handling Modifier

When this modifier is active, every personal data field is classified, minimized, and protected end-to-end — logs, retention, and deletion paths included. Regulatory exposure is treated as a defect, not an afterthought.

## Rules

1. **Classify before you persist.** Every new field is classified (personal, sensitive, or anonymous) before it's stored — an unclassified personal-data field is not stored at all.
2. **Minimize collection.** Only fields the feature demonstrably needs are collected — "might be useful later" is prohibited as a justification.
3. **No PII in telemetry.** Logs, analytics events, error reports, and URLs carry opaque IDs, never personal data.
4. **Retention and deletion paths exist.** Every store of personal data has a defined retention answer and a deletion path — a user's delete request cascades everywhere their data lives.
5. **New processing purposes need a legal basis.** Using personal data for a new purpose requires a consent or legal-basis check, reflected explicitly in the report.
6. **Pseudonymize or aggregate where possible.** When the feature allows it, prefer pseudonymized or aggregated data over raw identifiers.
7. **Export/deletion rights survive schema changes.** Data export and deletion code paths are updated alongside any migration that touches personal data.

## Behavioral Overrides

- The agent reviews every change against "what would a GDPR auditor ask about this?"
- Third-party data sharing (SDKs, analytics providers) discovered during the change is flagged explicitly.
- When privacy and product requirements conflict, the agent implements the privacy-preserving variant and reports the trade-off rather than silently picking the permissive one.
- `security-hardened` defends against attackers; `privacy-guard` governs lawful data handling — stack both in regulated products.
