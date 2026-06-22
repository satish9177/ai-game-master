# ADR-0004: Persistence — SQLite now, PostgreSQL later

- **Status:** Accepted — **partially implemented**: a headless, Node-only SQLite
  layer now exists ([ADR-0018](./ADR-0018-backend-sqlite-persistence-v0.md));
  the dual-dialect query tool and the PostgreSQL migration remain future shape only
- **Date:** 2026-06-21 (updated 2026-06-22)
- **Deciders:** Project owner

> **Update (ADR-0018):** principles 1, 2, 4, 5, 6, and 7 below are now realized
> by the `apps/web/src/persistence/**` build unit — repository interfaces in the
> domain (`WorldStore`, the new `RoomStore`), server-side-only data access
> (browser-excluded, lint-walled), migrations from day one, app-generated string
> ids, UTC timestamps, validated RoomSpec stored as a JSON document with a
> `schema_version` column, transactions owning atomicity, and re-validation at the
> persistence boundary. Principle 3 (a dual-dialect Drizzle/Kysely layer) is
> deliberately **not** adopted yet: `node:sqlite` with parameterized SQL confined
> to the adapter/migration files is sufficient for a SQLite-only v0, and the
> dual-dialect tool is revisited when the PostgreSQL migration actually approaches.

## Context

The product will need to persist generated rooms, sessions, and AI "memory". We
want to start simple (SQLite, zero-ops, file-based) but not repaint ourselves
into a corner when we move to PostgreSQL for a hosted, multi-user deployment.
None of this is built yet; this ADR fixes the principles so the seam lands in
the right place when it does.

## Decision

1. **Repository pattern.** The domain defines repository **interfaces**
   (`RoomRepository`, `SessionRepository`, …). Concrete adapters live in the
   backend. Business logic depends on the interface, never on a driver.
2. **Data access is server-side only.** SQLite is a *server* store, **not** an
   in-browser database. The browser talks to the backend API. UI and renderer
   **never** import SQL or a DB driver (see [BOUNDARIES](../BOUNDARIES.md)).
3. **Dual-dialect data layer.** Use a typed, SQL-first, lightweight tool that
   targets both SQLite and PostgreSQL (e.g. **Drizzle** or **Kysely**) so the
   switch is mostly configuration. **Not** a heavy ORM. Dialect-specific bits are
   isolated in the adapter.
4. **Migrations from day one**, versioned in-repo, even for SQLite.
5. **Portability rules:** app-generated **UUID** primary keys (not autoincrement);
   **UTC** timestamps; store the validated RoomSpec as a JSON document
   (`jsonb` in PG / `TEXT` in SQLite) with a `schema_version` column; avoid
   dialect-only features on the shared path.
6. **Transactions** are owned by the repository/unit-of-work layer; no ambient
   global connection in domain code.
7. **Validate at the persistence boundary too.** A stored/loaded spec is
   re-validated by the same domain schema — storage is not a trust boundary we
   skip.

## Consequences

- SQLite → PostgreSQL becomes a config + adapter change, not a rewrite.
- The renderer and UI remain oblivious to storage; persistence can evolve
  independently.
- Slightly more upfront discipline (interfaces, migrations, UUIDs) than "just
  open a DB", paid back the first time the schema changes or the dialect moves.

## Alternatives considered

- **A heavy ORM (e.g. full Prisma-style)** — deferred: more abstraction and ops
  than needed; conflicts with "no heavy frameworks unless approved".
- **Direct DB calls from services** — rejected: leaks SQL across layers and
  couples logic to a dialect.
- **In-browser SQLite (wasm)** — rejected for the system of record: persistence
  belongs server-side behind the API.
