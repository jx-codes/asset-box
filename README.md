# Asset Box

Asset Box is a single-user Cloudflare application for uploading, organizing, and viewing self-contained HTML assets. It provides a password-protected web library and revocable service tokens for CLI and agent uploads.

## Features

- Content-addressed HTML uploads with SHA-256 duplicate detection
- D1 metadata and R2 object storage
- Active and archived asset views
- Tag definitions with agent-facing guidance
- Signed, HttpOnly browser sessions
- Revocable service tokens with optional expiration and last-used metadata
- Login throttling and live updates through Durable Objects
- Sandboxed HTML previews
- OpenAPI documentation generated from canonical Zod schemas

## Stack

- Cloudflare Workers, D1, R2, Durable Objects, and Static Assets
- Hono with Zod/OpenAPI
- React and Vite
- TanStack Query and Legend State
- Tailwind CSS and shadcn/ui
- Bun, TypeScript, Vitest, and Biome

## Local development

### Prerequisites

- [Bun](https://bun.sh/)
- A Cloudflare account for deployed environments

### Setup

```sh
bun install
cp .dev.vars.example .dev.vars
```

Replace the values in `.dev.vars` with a development password and a random session secret of at least 32 characters. Never commit `.dev.vars`.

Apply the local D1 migrations and start the application:

```sh
bun run db:migrate:local
bun run dev
```

Vite prints the local URL. Sign in with the development password from `.dev.vars`.

## Service tokens and CLI uploads

Browser login uses `ASSET_BOX_PASSWORD`. Agents and the CLI use revocable service tokens instead of the account password.

1. Sign in to the web interface.
2. Open **Service tokens**.
3. Create a named token and save the plaintext when it is shown. It cannot be retrieved again.
4. Export the token and application URL before running the CLI:

```sh
export ASSET_BOX_URL=https://asset-box.example.com
export ASSET_BOX_SERVICE_TOKEN=abx_...

bun run asset-box upload ./page.html \
  --title "Launch page" \
  --blurb "Finished landing page for the launch" \
  --tags landing-page,launch
```

Tag slugs must already exist in the web interface. Uploading identical HTML returns the existing asset rather than creating a duplicate.

## API

After signing in, open `/api/docs` for the Scalar API reference or fetch `/api/openapi.json`.

- Browser requests authenticate with the signed `asset_box_session` cookie.
- Agent and CLI requests authenticate with `Authorization: Bearer <service-token>`.
- Service-token creation, listing, and revocation require a browser-authenticated session.

## Cloudflare deployment

Create a D1 database and R2 bucket for each environment, then replace the placeholder resource identifiers and names in `wrangler.jsonc`.

Set the browser password and session-signing secret through Wrangler's interactive secret prompt:

```sh
bunx wrangler secret put ASSET_BOX_PASSWORD --env prod
bunx wrangler secret put SESSION_SECRET --env prod
```

Apply migrations before deploying:

```sh
bun run db:migrate:prod
bun run deploy:prod
```

Equivalent `:uat` scripts are available for a UAT environment.

## Verification

Run the complete local check:

```sh
bun run check
```

This verifies formatting, linting, TypeScript, tests, and production builds.

## Security

- Production credentials belong in Cloudflare secrets, never source control.
- Local credentials belong in ignored `.dev.vars` files.
- Service-token plaintext is displayed once; D1 stores only its SHA-256 hash and non-secret metadata.
- Asset previews are authenticated and served with a restrictive sandbox policy.

## Project scope

Asset Box is maintained for the author's own use and is published so others can study it, run it, or build their own versions. This repository is not accepting contributions, feature requests, support requests, or roadmap proposals. Forks and independent development are welcome under the terms of the AGPL.

## License

Asset Box is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).
