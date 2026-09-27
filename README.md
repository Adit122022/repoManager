# Repo Manager

A React + Vite dashboard for browsing and analyzing GitHub repositories. GitHub OAuth runs through Better Auth on same-origin serverless routes, and GitHub API requests are proxied by Vercel Functions so OAuth credentials stay out of the browser bundle. Repository data lives in Zustand; analysis results are cached in localStorage for 24 hours.

## Run locally

1. Create a GitHub OAuth App. Set its callback URL to `http://localhost:5173/api/auth/callback/github`.
2. Copy `.env.example` to `.env.local`. Add the GitHub client ID and secret, a private random `BETTER_AUTH_SECRET` (at least 32 bytes), and keep `BETTER_AUTH_URL=http://localhost:5173`. Do not prefix secrets with `VITE_`.
3. Run `npm install` and `npm run dev`. The Vite development middleware serves the auth and GitHub proxy routes locally.

Better Auth requests the `repo` and `user:email` scopes. It uses stateless secure cookies; no database is configured. The GitHub access token is read by the server-side proxy and is never stored in browser localStorage or sessionStorage.

## Deploy to Vercel

Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` as Vercel environment variables. Set `BETTER_AUTH_URL` to the production origin and register `<production-origin>/api/auth/callback/github` as the GitHub OAuth callback URL. To connect the Better Auth Infrastructure dashboard, also set `BETTER_AUTH_API_KEY` (server-side only; never use a `VITE_` prefix). The dashboard plugin loads only when this key exists, so local auth can still run without it. Redeploy after changing Vercel environment variables. The `api/` directory provides the Vercel Functions; `vercel.json` routes SPA paths to the app.

For Infrastructure dashboard testing against a local server, expose Vite's port with `npx ngrok http 5173` (or `cloudflared tunnel --url http://localhost:5173`) and use the resulting HTTPS URL as the dashboard Base URL with Base Path `/api/auth`. Update `BETTER_AUTH_URL` and the GitHub OAuth callback URL to that tunnel origin while testing OAuth through the tunnel. A hosted dashboard cannot connect directly to `localhost`.

## Architecture

The four client layers are `src/domain` (models and policies), `src/application` (use cases and ports), `src/infrastructure` (Better Auth client, GitHub API adapter, and browser storage), and `src/presentation` (React, Zustand, and styles). Server handlers live in `api/`; `src/bootstrap.ts` assembles the client adapters.

## Data returned

One GitHub GraphQL request fetches the viewer and up to 100 most recently updated repositories, including description, primary language, topics, license, README presence, homepage, last update, stars, and archived status. The table supports sorting, text search, active/archive filters, language filtering, and analysis badges for naming patterns, dormancy, license, README quality, and deployments. README and deployment REST calls run with a five-request concurrency cap. Per-repository analysis entries expire after 24 hours. Repositories matching the throwaway naming pattern are excluded from deployment checks. The dashboard displays GitHub's remaining API quota and pauses analysis when it falls below 100. The GitHub proxy permits only the repository reads and GraphQL queries used by the app.
