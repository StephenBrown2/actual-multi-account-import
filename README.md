# Actual Multi-Account Import

Standalone importer for Actual Budget using `@actual-app/api` with three operating modes:

- **Web mode**: upload, preview, map fields, and import with account-column mapping (saved preferences per budget)
- **CLI mode**: import one file from the terminal
- **Watch mode**: auto-import files when they appear in a directory

Supported input extensions (through Actual's parser): `.csv`, `.tsv`, `.qif`, `.ofx`, `.qfx`, `.xml`.

## Requirements

- **Bun 1.3+** — used for installing dependencies (`bun install`) and running tests (`bun test`)
- **Node.js 20+** — required to run the server and CLI; `@actual-app/api` depends on `better-sqlite3`, which runs on Node
- Reachable Actual server and credentials (`ACTUAL_PASSWORD` or `ACTUAL_SESSION_TOKEN`)

The web server and CLI are executed via Node (using `tsx`). The Justfile and `package.json` scripts use `npm run` for those commands; use `just web`, `just cli`, etc., or run `npm run server` / `npm run cli` directly.

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

**Saved preferences**: Field mappings, account mappings, and amount options (in/out mode, split mode, etc.) are saved per budget in your browser. Use "Save preferences" to persist your current settings, or they auto-save after a successful import. When you preview a new file with the same column names, your saved preferences are applied automatically.

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
  --map-field "payee=Description" \
  --map-field "inOut=Type"
```

Important options:

- `--dry-run`: preview import without persisting
- `--allow-partial`: import valid rows even if some rows fail
- `--session-token`: use token auth instead of password
- `--budget-id` / `--budget-name` / `--sync-id`: select budget
- `--in-out-mode` + `--out-value <string>`: when your CSV has a single amount column plus an in/out indicator (e.g. "debit"/"credit"), use this to correctly classify transactions
- `--split-mode`: use separate inflow and outflow columns instead of a single amount column
- `--flip-amount`: negate all amounts (swap inflow↔outflow)
- `--multiplier-amount <n>`: multiply amounts by a factor (e.g. 0.01 for cents-to-dollars)

### Watch folder (auto-import)

Watch a directory and automatically import files when they appear:

```bash
just cli watch ./imports \
  --server-url http://localhost:5006 \
  --password your-password \
  --budget-name "Personal" \
  --default-account "Checking" \
  --map-field "date=Date" \
  --map-field "amount=Amount" \
  --map-field "payee=Description" \
  --in-out-mode \
  --out-value "debit"
```

Use the same mapping options as the regular import. Press Ctrl+C to stop.

## Docker

You can run the importer as a container using either `docker run` or Docker Compose. Use the image from GitHub Container Registry (GHCR) or build it locally.

### Run with `docker run`

**Using the image from GHCR** (after CI has published it; replace `owner/repo` with your GitHub org/repo, e.g. `stephenbrown2/actual-multi-account-import`):

```bash
docker run --rm -p 3000:3000 \
  -e ACTUAL_SERVER_URL=https://your-actual-server.com \
  -e ACTUAL_PASSWORD=your-password \
  -e ACTUAL_DATA_DIR=/data \
  -v actual_importer_data:/data \
  ghcr.io/owner/repo:latest
```

Then open `http://localhost:3000`. Add `-e ACTUAL_BUDGET_NAME="Your Budget"` (or `ACTUAL_BUDGET_ID`) if you have multiple budgets.

**Using a locally built image:**

```bash
just docker-build
just docker-run
```

`docker-run` uses `.env` for environment variables and publishes port 3000.

### Run with Docker Compose

1. Copy the example Compose file and set your environment:

   ```bash
   cp docker-compose.example.yml docker-compose.yml
   # Edit docker-compose.yml: set ACTUAL_SERVER_URL and ACTUAL_PASSWORD (image is already set for this repo)
   ```

2. Start the service:

   ```bash
   docker compose up -d
   ```

   Or use the Just recipe (uses the example file as-is; edit `docker-compose.example.yml` or pass your own file):

   ```bash
   just compose-up
   ```

3. Open `http://localhost:3000`. Stop with `docker compose down` or `just compose-down`.

The example Compose file uses a named volume for `ACTUAL_DATA_DIR` and exposes port 3000.

**CLI / Watch mode in Docker**: Override the command (either in the docker-compose.yml or with the run command) and mount your import directory. If `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, and `ACTUAL_BUDGET_NAME` are set in your `docker-compose.yml`, you can omit those flags from the command.

One-off import:

```bash
docker compose run --rm -v ./imports:/imports actual-multi-account-import \
  npm run cli -- /imports/transactions.csv \
  --server-url https://your-actual-server.com \
  --password your-password \
  --budget-name "Personal" \
  --default-account "Checking" \
  --map-field "date=Date" \
  --map-field "amount=Amount" \
  --map-field "payee=Description" \
  --in-out-mode --out-value "debit"
```

Watch folder (runs until Ctrl+C):

```bash
docker compose run --rm -v ./imports:/imports actual-multi-account-import \
  npm run cli -- watch /imports \
  --server-url https://your-actual-server.com \
  --password your-password \
  --budget-name "Personal" \
  --default-account "Checking" \
  --map-field "date=Date" \
  --map-field "amount=Amount" \
  --map-field "payee=Description" \
  --in-out-mode --out-value "debit"
```

Create an `imports` directory and drop CSV files into it for the watch command.

## GHCR Publishing

On pushes to `main`, GitHub Actions builds and pushes:

- `ghcr.io/<owner>/<repo>:latest`
- `ghcr.io/<owner>/<repo>:<commit-sha>` (full Git SHA)

Workflow file: `.github/workflows/publish-ghcr.yml`

## Validation

```bash
just verify
```

## Lint and Format

```bash
just lint
just lint-fix
just format-check
just format
```
