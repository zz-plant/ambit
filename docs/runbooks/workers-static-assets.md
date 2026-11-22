# Publishing the demo to Workers Static Assets

The demo is published to Cloudflare Workers at `ambit.kanav.net`: one version
per pull request, and a deploy on every merge to main. GitHub Pages published
the same files under `/ambit/` until the cutover, and is retired.

## What is in the repository

| File | What it does |
| --- | --- |
| `wrangler.jsonc` | The Worker, `ambit-web`: `dist/` as static assets, no Worker script, `ambit.kanav.net` as a custom domain |
| `.github/workflows/workers.yml` | A version URL for each pull request, and a deploy on merge |
| `scripts/site.ts` | The origin and the path prefix, read by the page, the docs and the sitemap |
| `scripts/rewrite-site-origin.ts` | Points the hand-written absolute URLs in `dist/` at the configured host |

`npm run build` ends with `site:origin`. The default origin and prefix are the
production ones, so that step usually writes nothing. The two variables exist
for a build published somewhere else: a preview, a fork, or a mirror under a
path.

## Setup

1. Create an API token with the **Workers Scripts: Edit** permission, and note
   the account id from the Cloudflare dashboard.
2. Add both as repository secrets: `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`. Without the token, a run warns that the merge was
   not deployed and stops; it does not fail.
3. Keep the repository variable `AMBIT_SITE_ORIGIN` set to
   `https://ambit.kanav.net`. The deploy refuses to run without it, because
   canonical links, Open Graph tags and the sitemap are built from it.
4. The custom domain is declared in `wrangler.jsonc`, so a deploy writes its
   DNS record and certificate for a zone in the same account. Without it the
   site answers on `ambit-web.<subdomain>.workers.dev`.

## A preview

Open a pull request that touches the site. The workflow uploads a version
aliased `pr-<number>` and comments its URL once. Each later push edits that
comment, so a long pull request keeps one link.

Fork pull requests get no secrets. The run says so in a notice and stops.

To do the same by hand:

```bash
npm run build
npx wrangler versions upload --preview-alias local
```

## Rollback

The Worker keeps its previous versions. Roll back in the dashboard under
**Deployments**, or redeploy an earlier commit with
`AMBIT_SITE_REVISION=<sha> npm run deploy:worker`.

The `gh-pages` branch still holds the last Pages deploy. Restoring the old
`pages.yml` from git history and pointing the links back would serve it again,
and nothing else in the repository depends on it.

## What to watch

- **Version skew.** A page loaded before a deploy may ask for a hashed asset
  the new version does not contain, and Workers answers from the current
  version's manifest, so it is a 404. The Pages workflow kept five builds of
  assets to avoid this; on Workers the window is one deploy, and the previous
  version stays available. If a report of a broken page arrives right after a
  deploy, this is the first thing to check.
- **No engine.** The Worker serves files. The page reads the origin it was
  built for from `meta[name=ambit-site-origin]` and skips the `/api/health`
  probe on it, so a custom domain behaves like `*.workers.dev`. An API on the
  Worker would need that check changed.
- **`robots.txt`.** It takes effect now that the site is at a host's root. Its
  `Sitemap:` line is rewritten to the configured origin at build time.
