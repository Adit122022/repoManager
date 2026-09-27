import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRepositories } from '../src/infrastructure/github/github-api'

describe('repository fetch rate-limit reporting', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports quota and reset headers before surfacing a rate-limit error', async () => {
    const resetSeconds = 2_000_000_000
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'API rate limit exceeded' }, {
      status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetSeconds) },
    })))
    const onRateLimit = vi.fn()
    await expect(fetchRepositories(onRateLimit)).rejects.toThrow('GitHub rate limit reached.')
    expect(onRateLimit).toHaveBeenCalledWith({ remaining: 0, resetAt: resetSeconds * 1000 })
  })

  it('loads only owned repositories and de-duplicates repository ids', async () => {
    const repo = { id: 'R_1', name: 'owned' }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      data: { viewer: { login: 'octo' }, viewerRepositories: { repositories: { nodes: [repo, repo] } } },
    }, { headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '2000000000' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchRepositories()
    const request = fetchMock.mock.calls[0][1]
    const query = JSON.parse(String(request?.body)).query as string

    expect(query).toContain('affiliations: [OWNER]')
    expect(query).not.toContain('COLLABORATOR')
    expect(query).not.toContain('ORGANIZATION_MEMBER')
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0].id).toBe('R_1')
  })
})
