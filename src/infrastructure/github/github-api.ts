import type { Repository, Viewer } from '../../domain/repositories/types'

export type GitHubRateLimit = { remaining: number | null; resetAt: number | null }

async function githubFetch(url: string, init: RequestInit = {}, observeRateLimit?: (snapshot: GitHubRateLimit) => void) {
  const response = await fetch(url, init)
  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  observeRateLimit?.({ remaining: remaining === null ? null : Number(remaining), resetAt: reset === null ? null : Number(reset) * 1000 })
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

const REPO_QUERY = `query RepoManagerRepositories {
  viewer { login name avatarUrl }
  viewerRepositories: viewer {
    repositories(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }, affiliations: [OWNER]) {
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

export async function fetchRepositories(observeRateLimit?: (snapshot: GitHubRateLimit) => void): Promise<{ repos: Repository[]; viewer: Viewer; rateRemaining: number | null; rateResetAt: number | null }> {
  const response = await githubFetch('/api/github/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: REPO_QUERY }),
  }, observeRateLimit)
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
    repos: Array.from(new Map((viewerRepositories.repositories.nodes as Repository[]).map(repo => [repo.id, repo])).values()),
    viewer,
    rateRemaining: remainingHeader === null ? null : Number(remainingHeader),
    rateResetAt: resetHeader === null ? null : Number(resetHeader) * 1000,
  }
}
