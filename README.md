# Table Topics Board

Game-show style Table Topics board for the Speaking Elephants Toastmasters club:
numbered curtain tiles, a full-screen question stage with a speech timer, a voting
list, a winner ceremony and certificates.

Questions are organised in **sets** (10, 15 or 20 questions) managed in the built-in
**Admin Panel** and stored in a database, so they are available from any device.
The app asks for a password on launch.

## Project layout

| Path | What it is |
| --- | --- |
| `public/` | The website (HTML, CSS, JS, images). The only folder that is published. |
| `server/sets-core.mjs` | Question-set API: password check, validation, starter sets. |
| `netlify/functions/sets.mjs` | Netlify Function exposing the API at `/api/sets`, backed by Netlify Blobs. |
| `dev-server.mjs` | Local preview server with the same API and a file-based database. |
| `netlify.toml` | Netlify build, functions and header configuration. |

## Run locally

Requires Node.js 20.12 or newer.

```bash
npm install
cp .env.example .env      # then set SITE_PASSWORD in .env
npm start                 # http://127.0.0.1:8155
```

Local sets are saved to `.local-data/sets.json` (not committed).
To run the real Netlify Function locally instead, use `npm run netlify:dev`.

## Deploy to Netlify

1. In Netlify choose **Add new site → Import an existing project** and pick this GitHub repository.
   The build settings are read from `netlify.toml` (no build command, publish directory `public`).
2. Open **Site configuration → Environment variables** and add `SITE_PASSWORD` with the password
   people will type on the login screen.
3. Trigger a deploy (**Deploys → Trigger deploy**) so the function picks up the variable.

Every push to `main` then redeploys the site automatically. Question sets are kept in
Netlify Blobs and survive deploys.

Without `SITE_PASSWORD` the API refuses every request and nobody can log in.

## Notes

- The password protects the question sets and the Admin Panel (it is checked on the server).
  The static shell of the app (layout, images) is publicly downloadable.
- **Export JSON / Import JSON** in the Admin Panel is a manual backup of all sets.
