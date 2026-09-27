import type { Repository, Viewer } from '../../domain/repositories/types'
const CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined
const TOKEN_KEY = 'repo-manager:github-token'
export const getToken = () => sessionStorage.getItem(TOKEN_KEY)
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY)
export const hasClientId = () => Boolean(CLIENT_ID)

async function githubFetch(url: string, init: RequestInit) {
  const response = await fetch(url, init)
  if (response.status === 401) { clearToken(); throw new Error('Your GitHub session has expired. Sign in again to refresh your repositories.') }
  if (response.status === 403 || response.status === 429) {
    const reset = response.headers.get('x-ratelimit-reset')
    const when = reset ? ` Try again after ${new Date(Number(reset) * 1000).toLocaleTimeString()}.` : ' Please wait a moment and try again.'
    throw new Error(`GitHub rate limit reached.${when}`)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error_description || body.message || `GitHub returned an error (${response.status}).`)
  }
  return response
}

export async function beginDeviceFlow() {
  if (!CLIENT_ID) throw new Error('GitHub sign in is not configured. Add VITE_GITHUB_CLIENT_ID to your environment.')
  const response = await githubFetch('https://github.com/login/device/code', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, scope: 'repo' }),
  })
  return response.json() as Promise<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>
}

export async function pollDeviceToken(deviceCode: string) {
  // GitHub returns OAuth's authorization_pending/slow_down states in its JSON body.
  // They are part of the device flow, so don't treat their 4xx response as a fatal error.
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  })
  if (response.status === 429 || response.status === 403) throw new Error('GitHub rate limit reached. Please wait a moment and try again.')
  return response.json() as Promise<{ access_token?: string; error?: string; interval?: number; error_description?: string }>
}

const REPO_QUERY = `query RepoManagerRepositories {
  viewer { login name avatarUrl }
  viewerRepositories: viewer {
    repositories(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
      nodes {
        id name nameWithOwner description url homepageUrl updatedAt stargazerCount isArchived isPrivate
        primaryLanguage { name color }
        repositoryTopics(first: 20) { nodes { topic { name } } }
        licenseInfo { name spdxId }
        readme: object(expression: "HEAD:README") { ... on Blob { id } }
        readmeMd: object(expression: "HEAD:README.md") { ... on Blob { id } }
      }
      totalCount
    }
  }
}`

export async function fetchRepositories(token: string): Promise<{ repos: Repository[]; viewer: Viewer; rateRemaining: number | null; rateResetAt: number | null }> {
  const response = await githubFetch('https://api.github.com/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: REPO_QUERY }),
  })
  const body = await response.json()
  if (body.errors?.length) {
    const message = body.errors[0].message as string
    if (/rate limit/i.test(message)) throw new Error('GitHub rate limit reached. Please wait a moment and try again.')
    throw new Error(message)
  }
  const { viewer, viewerRepositories } = body.data
  const remainingHeader = response.headers.get('x-ratelimit-remaining')
  const resetHeader = response.headers.get('x-ratelimit-reset')
  return {
    repos: viewerRepositories.repositories.nodes,
    viewer,
    rateRemaining: remainingHeader === null ? null : Number(remainingHeader),
    rateResetAt: resetHeader === null ? null : Number(resetHeader) * 1000,
  }
}
