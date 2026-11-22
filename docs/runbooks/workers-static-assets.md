# Publishing the demo to Workers Static Assets

The demo is published to GitHub Pages by `.github/workflows/pages.yml`. This is
the Cloudflare Workers path for the same files: one Worker version per pull
request, and a production deploy on demand. Nothing here runs until the
repository has Cloudflare credentials, so adding it changed no deploy.

## What is already in the repository

| File | What it does |
| --- | --- |
| `wrangler.jsonc` | The Worker, `ambit-web`: `dist/` as static assets, no Worker script |
| `.github/workflows/workers.yml` | A version URL for each pull request, and a dispatch-only production deploy |
| `scripts/site.ts` | The origin and the path prefix, read by the page, the docs and the sitemap |
| `scripts/rewrite-site-origin.ts` | Points the hand-written absolute URLs in `dist/` at the configured host |

`npm run build` ends with `site:origin`. On GitHub Pages that step finds the
default origin and prefix already in place and writes nothing.

## One-time setup

1. Create an API token with the **Workers Scripts: Edit** permission, and note
   the account id from the Cloudflare dashboard.
2. Add both as repository secrets: `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`.
3. Add a repository variable `AMBIT_SITE_ORIGIN`, the origin the site is
   published under: `https://ambit.kanav.net`. Canonical links, Open Graph tags
   and the sitemap are built from it, so a production deploy refuses to run
   without it.
4. Add that host to the `ambit-web` Worker as a custom domain, under
   **Settings > Domains & Routes**. Cloudflare writes the DNS record for a zone
   it hosts. Without one the site answers on
   `ambit-web.<subdomain>.workers.dev`, and `AMBIT_SITE_ORIGIN` has to name that
   address instead.

## A preview

Open a pull request that touches the site. The workflow uploads a version
aliased `pr-<number>` and comments its URL once. Each later push edits that
comment, so a long pull request keeps one link.

Fork pull requests get no secrets. The run says so in a notice and stops.

To do the same by hand:

```bash
AMBIT_SITE_BASE=/ AMBIT_SITE_ORIGIN=https://ambit.kanav.net npm run build
npx wrangler versions upload --preview-alias local
```

## Cutover from Pages

The two paths can serve the same commit for a while, and that is the point:
check the Worker against the live site before moving any link.

1. Dispatch **Workers** on `main` and open the production URL. Walk the map,
   the docs index, one doc page, and `llms.txt`.
2. Confirm the canonical link in the page source names the new origin, not
   `zz-plant.github.io`.
3. Move the links. These files name the old origin and are not built from
   `scripts/site.ts`:

   ```bash
   rg -l 'zz-plant\.github\.io/ambit' README.md SUPPORT.md CITATION.cff \
     docs src/client/index.html src/client/public
   ```

   `docs/runbooks/` is not published, so this file can keep its examples.
4. Disable `pages.yml`: delete the workflow, or drop its `push` trigger and
   keep `workflow_dispatch` for a rollback. A deploy that writes to `gh-pages`
   after cutover would serve a second, older copy of the site.
5. To publish on every merge instead of on dispatch, change the `production`
   job's condition to `github.event_name == 'push'` and add the `push` trigger
   with the same `paths` list the preview uses.

## What to watch

- **Version skew.** A page loaded before a deploy may ask for a hashed asset
  the new version does not contain, and Workers answers that from the current
  version's manifest, so it is a 404. `pages.yml` kept five builds' assets in
  `assets/` to avoid this. On Workers the window is one deploy, and the
  previous version stays available for rollback in the dashboard. If a report
  of a broken page arrives right after a deploy, this is the first thing to
  check.
- **No engine.** The Worker serves files. `isHostedDemo` treats
  `*.workers.dev` like `*.github.io`, so the page skips the `/api/health`
  probe and shows the sample rather than a console error. An API on the Worker
  would need that list changed back.
- **`robots.txt`.** Crawlers read it only at a host's root, so it has had no
  effect under `/ambit/`. A Worker serving the root makes it live, and its
  `Sitemap:` line is rewritten to the configured origin at build time.
