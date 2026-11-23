# Events by Buddies & Bites: Cloudflare backend

One Cloudflare Worker serves the website (`public/`) and the API (`/api/*`). Data lives in a D1 database.

## Deploy (about 10 minutes)

1. Install Node.js, then log in to Cloudflare:
   `npx wrangler login`
2. Create the database. Copy the `database_id` it prints into `wrangler.toml`:
   `npx wrangler d1 create buddies-bites-db`
3. Create the tables:
   `npx wrangler d1 execute buddies-bites-db --remote --file=schema.sql`
4. Set your admin secret (use a long random value, 30+ characters, and keep it private):
   `npx wrangler secret put ADMIN_TOKEN`
5. Deploy:
   `npx wrangler deploy`

Cloudflare prints your live address (`https://events-by-buddies-and-bites.<your-account>.workers.dev`). You can attach your own domain later in the Cloudflare dashboard.

## What the API protects

- The public store route returns only retail price, MRP, stock and GST. Bulk and purchase prices never leave the server except through admin routes.
- Bulk rates are applied on the server when a customer approved as a bulk buyer places an order.
- Customers see only their own orders, tickets and enquiries.
- Every `/api/admin/*` route needs `Authorization: Bearer <ADMIN_TOKEN>`.
- Customer passwords are salted and hashed (PBKDF2).

## Not included yet

- Login rate limiting (add Cloudflare rate limiting or Turnstile before going public).
- Offer codes applied at checkout.
- The store and admin screens that call this API (the next step).

## Two separate portals

- Store portal: `public/index.html`, served at `/` (customers: shop, accounts, support desk).
- Admin portal: `public/admin/index.html`, served at `/admin/` (dashboard, orders, products, stock, tickets, bulk customers, offers and posters, billing, ledger, tax, analytics). It is installable on Android and iPhone (manifest, icons and service worker are in `public/admin/`) and is kept out of search engines.
- Both portals currently save data in the browser (same device only) and do not call the API yet. The admin PIN is the demo PIN `1234`. Connecting both to `/api/*` is the next step.
- `src/worker.js`, `schema.sql`, `wrangler.toml`: the Cloudflare API and database.

## GitHub

1. Create a repository, then upload the contents of this folder (keep the `public` folder and the hidden `.github` folder).
2. Preview: in the repository go to Settings, Pages, and set Source to GitHub Actions. Each push to `main` publishes the `public` folder. The store opens at `https://<username>.github.io/<repo>/` and the admin at `.../admin/`.
3. Do not commit secrets. `ADMIN_TOKEN` is set with `wrangler secret put` and never goes in a file.
4. See `TESTING.md` for the test checklist.
