# Repo Manager

A client-side React + Vite dashboard for browsing and analyzing GitHub repositories. It uses GitHub's OAuth device flow, GraphQL API, and read-only REST endpoints. Repository data is held in memory with Zustand, the OAuth token is stored in `sessionStorage` for the current browser tab, and derived analysis results are cached in `localStorage` for 24 hours.

## Run locally

1. Create a GitHub OAuth App under **Settings → Developer settings → OAuth Apps** and enable Device Flow.
2. Copy `.env.example` to `.env.local` and set `VITE_GITHUB_CLIENT_ID` to the OAuth App's client ID. No client secret or personal access token is used in the browser.
3. Run `npm install` and `npm run dev`.

The app requests the `repo` scope. The OAuth token stays in that tab's session storage until sign-out or the tab closes. The client ID is public and is included in the browser bundle.

## Deploy to Vercel

Set `VITE_GITHUB_CLIENT_ID` in the Vercel project environment variables and deploy. `vercel.json` routes SPA paths to `index.html`.

## Architecture

The client uses four layers: `src/domain` for models and rules, `src/application` for use cases and ports, `src/infrastructure` for GitHub and browser storage adapters, and `src/presentation` for React, Zustand, and styles. `src/bootstrap.ts` assembles the adapters and use cases.

## Data returned

One GitHub GraphQL request fetches the viewer and up to 100 most recently updated repositories, including description, primary language, topics, license, README presence, homepage, last update, stars, and archived status. The table supports sorting, text search, active/archive filters, language filtering, and analysis badges for naming patterns, dormancy, license, README quality, and deployments. README and deployment REST calls run with a five-request concurrency cap. Per-repository analysis entries expire after 24 hours. Repositories matching the throwaway naming pattern are excluded from deployment checks. The dashboard displays GitHub's remaining API quota and pauses analysis when it falls below 100.