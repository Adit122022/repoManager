# Repo Manager

Repo Manager is a React, Vite, and Tailwind app for reviewing GitHub repositories, analyzing their health, and managing selected repositories. Better Auth handles sign-in; Vercel Functions keep GitHub OAuth credentials and access tokens on the server. Repository analysis and triage decisions stay in the browser.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAdit122022%2Fempty6)

## GitHub OAuth setup

1. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set the homepage URL to `http://localhost:5173` for development (or your production origin).
3. Set the Authorization callback URL to `http://localhost:5173/api/auth/callback/github` for local development. Use a separate OAuth App for production, with `<production-origin>/api/auth/callback/github` as its callback.
4. Copy the generated client ID and client secret into the server environment variables below.

Repo Manager requests `repo` to read repositories and support the app's explicitly confirmed topic, archive, and delete actions. It also requests `user:email` so Better Auth can retrieve the email associated with the GitHub identity, including a private email address. The GitHub access token is used by the server proxy and is not saved in browser storage.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET` (a private random value of at least 32 bytes), and `BETTER_AUTH_URL=http://localhost:5173`. Do not add a `VITE_` prefix to secrets.
3. Run `npm install`, then `npm run dev`.

Vite serves the Better Auth and GitHub proxy handlers locally. Optional `BETTER_AUTH_API_KEY` connects the Better Auth Infrastructure dashboard; leave it empty if you do not use that service.

## Deploy to Vercel

Use the button above or import the repository into Vercel. In **Project Settings → Environment Variables**, add:

| Variable | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `BETTER_AUTH_SECRET` | Private random secret, at least 32 bytes |
| `BETTER_AUTH_URL` | Production origin, such as `https://your-app.vercel.app` |
| `BETTER_AUTH_API_KEY` | Optional Better Auth Infrastructure server key |

Register `<production-origin>/api/auth/callback/github` in the production GitHub OAuth App, then redeploy after setting the environment variables. The `api/` directory contains the Vercel Functions and `vercel.json` routes application paths to the SPA.

## Features

- Sortable and searchable repository table with language, license, README, dormancy, and deployment analysis.
- Repository topic updates, confirmed archiving, and per-repository deletion with exact-name confirmation.
- Session-only action log and JSON report export, including analysis flags and recorded actions.
- A low GitHub API quota banner with the estimated reset time; repository analysis pauses below 100 remaining requests.
- Analysis results cached in `localStorage` for 24 hours and triage decisions persisted per GitHub login.

## Project structure

The client uses four layers: `src/domain` for models and policies, `src/application` for use cases and ports, `src/infrastructure` for auth/API/storage adapters, and `src/presentation` for React, Zustand, and styles. Server handlers live in `api/` and `server/`.

## Development checks

Run `npm test` for the automated unit and UI suite. Run `npm run build` to type-check and create the production Vite bundle.
