# Repo Manager

A client-side React + Vite dashboard for browsing and analyzing GitHub repositories. It uses GitHub's OAuth device flow, GraphQL API, and read-only REST endpoints. Repository data is held in memory with Zustand, the OAuth token is stored in `sessionStorage` for the current browser tab, and derived analysis results are cached in `localStorage` for 24 hours.

## Run locally

1. Create a GitHub OAuth App under **Settings → Developer settings → OAuth Apps** and enable **Device Flow** for the app.
2. Copy `.env.example` to `.env.local` and set `VITE_GITHUB_CLIENT_ID` to the OAuth App's client ID. No client secret or personal access token is used in the browser.
3. Install dependencies and start Vite:

   ```sh
   npm install
   npm run dev
   ```

The app requests the `repo` scope, which grants access to private repositories. Treat the deployed app as a public client: its client ID is visible in the browser, and the OAuth token remains in that tab's session storage until sign-out or the tab closes.

## Deploy to Vercel

Import the project into Vercel, set `VITE_GITHUB_CLIENT_ID` in the project environment variables, and deploy. `vercel.json` routes SPA paths to `index.html`. Redeploy after changing environment variables.

## Architecture

The client is organized into four layers:

- `src/domain` contains repository and analysis models plus pure classification rules.
- `src/application` contains analysis use cases and the ports they need.
- `src/infrastructure` implements those ports with GitHub REST/GraphQL, session storage, and the local analysis cache.
- `src/presentation` contains the React app, Zustand UI state, and styles.

`src/bootstrap.ts` is the composition root: it wires infrastructure adapters into application use cases. Dependencies point inward through application ports, keeping GitHub and browser storage details out of the analysis rules.

## Data returned

One GitHub GraphQL request fetches the viewer and up to 100 most recently updated repositories, including description, primary language, topics, license, README presence, homepage, last update, stars, and archived status. The table supports sorting, text search, active/archive filters, language filtering, and analysis badges for naming patterns, dormancy, license, README quality, and deployments. README and deployment REST calls run with a five-request concurrency cap. Per-repository analysis entries use keys in the form `repo-manager:analysis:<repoId>:<analysisType>` and expire after 24 hours. Repositories with names matching the throwaway pattern are excluded from deployment checks. The dashboard displays GitHub's remaining API quota and pauses analysis when it falls below 100.
