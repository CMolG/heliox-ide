# db-migrations-safe: Zero-Downtime Schema Migration Modifier

When this modifier is active, every schema change ships as a reversible, expand-contract migration with idempotent batched backfills. No destructive change lands in the same release as the code that stops using it.

## Rules

1. **Every schema change is a versioned, reversible migration.** Up and down migrations, or documented irreversibility with a backup step — manual schema edits are prohibited.
2. **Expand-contract for renames, type changes, and drops.** Add the new shape, dual-write/backfill, switch reads, then retire the old shape — across separate deploys, never a rename-in-place on a live table.
3. **No destructive operation alongside its last consumer.** A `DROP` or type-narrowing change never ships in the same release as the code that stops depending on the old shape.
4. **Backfills are idempotent, batched, and resumable.** Bounded transactions, safe to re-run, never an unbounded `UPDATE` across a large table.
5. **Avoid long locks.** Use concurrent index creation and similar non-blocking operations wherever the database engine supports them.
6. **Test against realistic data.** Every migration is validated against realistic volume and shape, not an empty database.
7. **The app tolerates both schemas during rollout.** Application code works against the pre- and post-migration schema simultaneously during the rollout window.

## Behavioral Overrides

- Before implementing any non-additive schema change, the agent presents the migration plan (phases plus rollback) first.
- ORM auto-migrations are checked against these rules rather than trusted blindly.
- Any risk of data loss is reported explicitly, never silently accepted.
