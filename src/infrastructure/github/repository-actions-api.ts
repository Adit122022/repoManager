import type { Repository } from '../../domain/repositories/types'

type Fetcher = typeof fetch
export type ActionRateLimit = { remaining: number | null; resetAt: number | null }
export type ActionApiOptions = { fetcher?: Fetcher; onRateLimit?: (snapshot: ActionRateLimit) => void }

function endpoint(repo: Repository) {
  const [owner, name] = repo.nameWithOwner.split('/')
  if (!owner || !name) throw new Error('Invalid repository name.')
  return `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

async function send(url: string, init: RequestInit, { fetcher = fetch, onRateLimit }: ActionApiOptions = {}) {
  const response = await fetcher(url, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...init.headers },
  })
  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  onRateLimit?.({ remaining: remaining === null ? null : Number(remaining), resetAt: reset === null ? null : Number(reset) * 1000 })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || `GitHub returned an error (${response.status}).`)
  }
}

export async function addTopic(repo: Repository, topic: string, options: ActionApiOptions = {}) {
  const normalized = topic.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(normalized)) throw new Error('Use a topic with 1–50 lowercase letters, numbers, or hyphens.')
  const current = repo.repositoryTopics.nodes.map(({ topic: item }) => item.name.toLowerCase())
  const names = Array.from(new Set([...current, normalized]))
  if (names.length > 20) throw new Error('GitHub allows up to 20 repository topics; remove one before adding another.')
  await send(`${endpoint(repo)}/topics`, { method: 'PUT', body: JSON.stringify({ names }) }, options)
}

export async function archiveRepository(repo: Repository, options: ActionApiOptions = {}) {
  await send(endpoint(repo), { method: 'PATCH', body: JSON.stringify({ archived: true }) }, options)
}

export async function deleteRepository(repo: Repository, options: ActionApiOptions = {}) {
  await send(endpoint(repo), { method: 'DELETE' }, options)
}

export function matchesExactRepositoryName(repoName: string, typedName: string) {
  return typedName === repoName
}
