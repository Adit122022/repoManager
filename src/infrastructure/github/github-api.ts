import type { Repository, Viewer } from '../../domain/repositories/types'
import type { SummaryContextResult } from '../../application/ports/ai-ports'
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

type RepoRestResult = { response: Response; body: any; rateLimit: { remaining: number | null; resetAt: number | null } }

function rateLimitFrom(response: Response) {
  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  return { remaining: remaining === null ? null : Number(remaining), resetAt: reset === null ? null : Number(reset) * 1000 }
}

async function repositoryRequest(path: string, init: RequestInit = {}): Promise<RepoRestResult> {
  const token = getToken()
  if (!token) throw new Error('Your GitHub session is missing. Sign in again.')
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  })
  const rateLimit = rateLimitFrom(response)
  if (response.status === 401) { clearToken(); throw new Error('Your GitHub session expired. Sign in again.') }
  const body = await response.json().catch(() => null)
  if (!response.ok && response.status !== 404) {
    if (response.status === 403 || response.status === 429) throw new Error(`GitHub rate limit or access restriction: ${body?.message || response.status}`)
    throw new Error(body?.message || `GitHub returned an error (${response.status}).`)
  }
  return { response, body, rateLimit }
}

function repositoryPath(repo: Repository) {
  return repo.nameWithOwner.split('/').map(encodeURIComponent).join('/')
}

function decodeBase64(encoded: string) {
  const binary = atob(encoded.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
}

const SKIP_TREE_PATH = /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|target)(\/|$)/i
const SKIP_TREE_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|Gemfile\.lock|poetry\.lock)$/i

function summarizeTree(entries: Array<{ path?: string; type?: string }>, wasTruncated: boolean) {
  const paths = entries
    .filter(entry => entry.type === 'blob' && entry.path && !SKIP_TREE_PATH.test(entry.path) && !SKIP_TREE_FILE.test(entry.path))
    .map(entry => entry.path!)
    .sort((a, b) => {
      const score = (path: string) => path.includes('/') ? 0 : /^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|composer\.json|Makefile|Dockerfile)$/i.test(path) ? 2 : 1
      return score(b) - score(a) || a.localeCompare(b)
    })
  const selected: string[] = []
  let chars = 0
  for (const path of paths) {
    const shortPath = path.slice(0, 180)
    if (selected.length >= 120 || chars + shortPath.length + 1 > 9000) break
    selected.push(shortPath); chars += shortPath.length + 1
  }
  const limited = wasTruncated || selected.length < paths.length
  return `Repository file paths${limited ? ' (representative subset; tree truncated to fit a small prompt)' : ''}:\n${selected.join('\n') || '(No file paths returned)'}`
}

export async function fetchSummaryContext(repo: Repository): Promise<SummaryContextResult> {
  const basePath = repositoryPath(repo)
  const readme = await repositoryRequest(`/repos/${basePath}/readme`)
  if (readme.response.ok && typeof readme.body?.content === 'string') {
    const content = decodeBase64(readme.body.content).slice(0, 10_000)
    return { context: { source: 'README', content }, rateLimit: readme.rateLimit }
  }

  const details = await repositoryRequest(`/repos/${basePath}`)
  const branch = String(details.body?.default_branch || 'HEAD')
  const tree = await repositoryRequest(`/repos/${basePath}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
  if (!tree.response.ok) throw new Error(tree.body?.message || 'Could not read this repository’s file tree.')
  return {
    context: { source: 'file tree', content: summarizeTree(tree.body?.tree || [], Boolean(tree.body?.truncated)) },
    rateLimit: tree.rateLimit,
  }
}

export async function patchRepositoryDescription(repo: Repository, description: string) {
  const { response } = await repositoryRequest(`/repos/${repositoryPath(repo)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description }),
  })
  if (!response.ok) throw new Error('GitHub did not update the repository description.')
}
