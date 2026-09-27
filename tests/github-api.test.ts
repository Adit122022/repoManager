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
})
