# Actual Multi-Account Import

Standalone importer for Actual Budget using `@actual-app/api` with two operating modes:

- **CLI mode**: import one file from the terminal
- **Web mode**: upload, preview, map fields, and import with account-column mapping

Supported input extensions (through Actual's parser): `.csv`, `.tsv`, `.qif`, `.ofx`, `.qfx`, `.xml`.

## Requirements

- Bun 1.3+
- Node.js 20+ (runtime for `@actual-app/api`/`better-sqlite3`)
- React + Vite frontend build (handled by npm scripts in this repo)
- Reachable Actual server
- Actual credentials (`ACTUAL_PASSWORD` or `ACTUAL_SESSION_TOKEN`)

## Install

```bash
bun install
```

## Environment

Copy `.env.example` and set values:

```bash
cp .env.example .env
```

Environment variable reference (same as `.env.example`):

- `PORT`: HTTP port for this importer service (web UI + API).
- `ACTUAL_SERVER_URL`: Base URL of your Actual server.
- `ACTUAL_PASSWORD`: Actual server password for API login.
- `ACTUAL_SESSION_TOKEN`: Optional token auth alternative to password.
- `ACTUAL_DATA_DIR`: Local cache/state directory used by `@actual-app/api`.
- `ACTUAL_BUDGET_ID`: Optional exact budget ID to load.
- `ACTUAL_BUDGET_NAME`: Optional budget name to load.
- `ACTUAL_SYNC_ID`: Optional sync/group ID to auto-download/load budget.

How to get values:

- **Server URL/password**: from your Actual server setup or hosting config.
- **Session token**: from an authenticated Actual API session (optional).
- **Budget ID/name**: listed by the app when multiple budgets are available; name is visible in Actual UI.
- **Sync ID**: the budget cloud sync/group ID associated with the budget.

## Web Mode

Run:

```bash
just web
```

Open `http://localhost:3000`.

For frontend-only development (React/Vite):

```bash
just web-dev
```

To build the React UI bundle only:

```bash
just web-build
```

Web flow:

1. Upload import file
2. Preview rows
3. Map columns (near-1:1 React flow adapted from Actual ImportTransactionsModal)
4. Map account column values to Actual account IDs
5. Import (or dry run)

## CLI Mode

Basic:

```bash
just cli ./transactions.csv \
  --server-url http://localhost:5006 \
  --password your-password \
  --budget-name "Personal" \
  --default-account "Checking"
```

Multi-account mapping from a CSV column:

```bash
just cli ./transactions.csv \
  --server-url http://localhost:5006 \
  --password your-password \
  --budget-name "Personal" \
  --account-column Account \
  --map-account "Business Checking=acct_business_id" \
  --map-account "Joint Checking=acct_joint_id" \
  --map-field "date=Date" \
  --map-field "amount=Amount" \
  --map-field "payee=Description"
```

Important options:

- `--dry-run`: preview import without persisting
- `--allow-partial`: import valid rows even if some rows fail
- `--session-token`: use token auth instead of password
- `--budget-id` / `--budget-name` / `--sync-id`: select budget

## Docker

Build locally:

```bash
just docker-build
```

Run server in Docker:

```bash
just docker-run
```

`docker-compose.example.yml` includes a complete baseline setup.

Run compose example:

```bash
just compose-up
```

Stop compose example:

```bash
just compose-down
```

## GHCR Publishing

On pushes to `main`, GitHub Actions builds and pushes:

- `ghcr.io/<owner>/<repo>:latest`
- `ghcr.io/<owner>/<repo>:sha-<shortsha>`

Workflow file: `.github/workflows/publish-ghcr.yml`

## Validation

```bash
just verify
```

## Lint and Format

```bash
just lint
just lint-fix
just format
just format-check
```
