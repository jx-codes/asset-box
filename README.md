# Asset Box

Asset Box is a single-user Cloudflare application for uploading, organizing, reviewing, and revising content-addressed HTML resources. A resource can be one self-contained HTML document or a multi-page set of HTML files rooted at `index.html`. It provides a password-protected web library plus revocable service-token workflows for CLIs and agents.

## Features

- Content-addressed single-page and multi-page HTML uploads with SHA-256 duplicate detection
- D1 metadata and R2 object storage
- Active and archived asset views
- Tag definitions with agent-facing guidance
- Durable freeform work requests for existing and completely new assets
- Private draft comments with explicit individual and atomic submit-all actions
- Expiring service-token claims with immutable comment snapshots
- Idempotent result pushes that create content-addressed revisions with request lineage
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
cp wrangler.example.jsonc wrangler.jsonc
```

Replace the values in `.dev.vars` with a development password and a random session secret of at least 32 characters. Never commit `.dev.vars`.

Apply the local D1 migrations and start the application:

```sh
bun run db:migrate:local
bun run dev
```

Vite prints the local URL. Sign in with the development password from `.dev.vars`.

## Service tokens and CLI workflows

Browser login uses `ASSET_BOX_PASSWORD`. Agents and the CLI use revocable service tokens instead of the account password.

1. Sign in to the web interface.
2. Open **Service tokens**.
3. Create a named token and save the plaintext when it is shown. It cannot be retrieved again.
4. Export the token and application URL before running the CLI:

```sh
export ASSET_BOX_URL=https://asset-box.example.com
export ASSET_BOX_SERVICE_TOKEN=abx_...
```

Upload a standalone asset directly:

```sh
bun run asset-box upload ./page.html \
  --title "Launch page" \
  --blurb "Finished landing page for the launch" \
  --tags landing-page,launch
```

Upload a multi-page resource by passing a directory. The directory must contain `index.html`; nested HTML paths and relative links are preserved under the same asset URL:

```sh
bun run asset-box upload ./site \
  --title "Product guide" \
  --blurb "Multi-page product documentation" \
  --tags documentation,product
```

A resource may contain up to 50 HTML files and 5 MB total. Every file must be a complete HTML document.

Pulling an asset-edit request materializes `source.html` for existing clients and also writes the complete source file set under `source/` when the asset is multi-page:

```sh
bun run asset-box pull --out ./asset-box-work --lease-seconds 900
# Or claim a specific submitted request:
bun run asset-box pull 9a232244-4e6b-4592-ad15-6ca4e2a0e45f --out ./asset-box-work
```

Create a complete result document at `./asset-box-work/result.html`, or create a multi-page result directory rooted at `index.html`, then push it with metadata:

```sh
bun run asset-box push ./asset-box-work \
  --html result.html \
  --title "Updated launch page" \
  --blurb "Revision implementing the submitted feedback" \
  --tags landing-page,launch
```

For a multi-page result:

```sh
bun run asset-box push ./asset-box-work \
  --html result \
  --title "Updated product guide" \
  --blurb "Multi-page revision implementing the submitted feedback" \
  --tags documentation,product
```

`request.json` carries the claim's server-issued idempotency key. Repeating the same push returns the original result instead of creating a second revision. New-asset requests omit source files. Tag slugs must already exist in the web interface.

## API

After signing in, open `/api/docs` for the Scalar API reference or fetch `/api/openapi.json`.

- Browser requests authenticate with the signed `asset_box_session` cookie.
- Agent and CLI requests authenticate with `Authorization: Bearer <service-token>`.
- Service-token creation, listing, and revocation require a browser-authenticated session.
- Browser-only work-request routes create requests, queue private drafts, and explicitly submit one or all drafts.
- Service-token agent routes list submitted work, claim a snapshot, pull the complete source resource, and push a complete single-page or multi-page result.
- Asset files are stored under an immutable SHA-256 resource ID; the parent resource and parent asset row are never overwritten.
- D1 is canonical for comments, claims, snapshots, and lineage. Durable Object events only prompt subscribers to refetch.

## Cloudflare deployment

Create a D1 database and R2 bucket for each deployed environment.

Replace the placeholder resource identifiers and names in the ignored `wrangler.jsonc`. This local file contains deployment-specific bindings and must not be committed.

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
- Draft request comments are excluded from every service-token work query until explicitly submitted.
- Claim ownership is bound to the authenticated token ID, and revoked or expired tokens fail authentication on every operation.

## Project scope

Asset Box is maintained for the author's own use and is published so others can study it, run it, or build their own versions. This repository is not accepting contributions, feature requests, support requests, or roadmap proposals. Forks and independent development are welcome under the terms of the AGPL.

## License

Asset Box is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).
