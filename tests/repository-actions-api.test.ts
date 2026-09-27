import { describe, expect, it, vi } from 'vitest'
import type { Repository } from '../src/domain/repositories/types'
import { addTopic, archiveRepository, deleteRepository, matchesExactRepositoryName } from '../src/infrastructure/github/repository-actions-api'

const repo: Repository = {
  id: '1', name: 'app', nameWithOwner: 'octo/app', description: null, url: 'https://github.com/octo/app', homepageUrl: null,
  updatedAt: '2026-01-01T00:00:00Z', stargazerCount: 0, isArchived: false, isPrivate: false,
  primaryLanguage: null, repositoryTopics: { nodes: [{ topic: { name: 'existing' } }] }, licenseInfo: null, readme: null, readmeMd: null,
}

describe('addTopic', () => {
  it('adds a normalized topic while preserving existing topics through GitHub PUT', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    await addTopic(repo, ' Learning-Project ', { fetcher })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith('/api/github/repos/octo/app/topics', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ names: ['existing', 'learning-project'] }),
    }))
  })

  it('rejects invalid names before sending a request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(addTopic(repo, 'not a topic', { fetcher })).rejects.toThrow('1–50 lowercase letters')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('surfaces GitHub failures for per-repository retry handling', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'Repository permission denied.' }, { status: 403 }))
    await expect(addTopic(repo, 'learning-project', { fetcher })).rejects.toThrow('Repository permission denied.')
  })

  it('reports remaining quota and reset time from write responses, including errors', async () => {
    const resetSeconds = 2_000_000_000
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'API rate limit exceeded' }, {
      status: 403, headers: { 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': String(resetSeconds) },
    }))
    const onRateLimit = vi.fn()
    await expect(addTopic(repo, 'learning-project', { fetcher, onRateLimit })).rejects.toThrow('API rate limit exceeded')
    expect(onRateLimit).toHaveBeenCalledWith({ remaining: 12, resetAt: resetSeconds * 1000 })
  })

  it('archives one repository with the explicit archived=true PATCH', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    await archiveRepository(repo, { fetcher })
    expect(fetcher).toHaveBeenCalledWith('/api/github/repos/octo/app', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ archived: true }),
    }))
  })

  it('deletes only through the repository-specific DELETE endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    await deleteRepository(repo, { fetcher })
    expect(fetcher).toHaveBeenCalledWith('/api/github/repos/octo/app', expect.objectContaining({ method: 'DELETE' }))
  })

  it('requires the exact full repository name for deletion confirmation', () => {
    expect(matchesExactRepositoryName('octo/app', 'octo/app')).toBe(true)
    expect(matchesExactRepositoryName('octo/app', 'app')).toBe(false)
    expect(matchesExactRepositoryName('octo/app', 'octo/App')).toBe(false)
    expect(matchesExactRepositoryName('octo/app', ' octo/app')).toBe(false)
  })
})
