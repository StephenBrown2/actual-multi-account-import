set shell := ["bash", "-cu"]

default:
  @just --list

install:
  bun install

check:
  bun run check

lint:
  bun run lint

lint-fix:
  bun run lint:fix

format:
  bun run format

format-check:
  bun run format:check

test:
  bun test

verify: check lint format-check test

web:
  npm run server

web-dev:
  npm run web:dev

web-build:
  npm run web:build

cli *args:
  npm run cli -- {{args}}

docker-build tag="actual-multi-account-import:local":
  docker build -t {{tag}} .

docker-run tag="actual-multi-account-import:local":
  docker run --rm -p 3000:3000 --env-file .env {{tag}}

compose-up:
  docker compose -f docker-compose.example.yml up -d

compose-down:
  docker compose -f docker-compose.example.yml down
