import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authApi } = vi.hoisted(() => ({
  authApi: { getSession: vi.fn(), getAccessToken: vi.fn() },
}))

vi.mock('../server/auth', () => ({ auth: { api: authApi } }))

import { githubProxy } from '../server/github-proxy'

describe('GitHub proxy topic-write allowlist', () => {
  const fetchUpstream = vi.fn<typeof fetch>()

  beforeEach(() => {
    authApi.getSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    authApi.getAccessToken.mockReset().mockResolvedValue({ accessToken: 'test-token' })
    fetchUpstream.mockReset().mockResolvedValue(Response.json({ names: ['learning-project'] }, { status: 200 }))
    vi.stubGlobal('fetch', fetchUpstream)
  })

  it('forwards an authenticated PUT topic update to GitHub', async () => {
    const request = new Request('http://localhost/api/github/repos/octo/app/topics', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: 'session=test' },
      body: JSON.stringify({ names: ['existing', 'learning-project'] }),
    })
    const response = await githubProxy(request)
    expect(response.status).toBe(200)
    expect(fetchUpstream).toHaveBeenCalledOnce()
    const [url, init] = fetchUpstream.mock.calls[0]
    expect(String(url)).toBe('https://api.github.com/repos/octo/app/topics')
    expect(init?.method).toBe('PUT')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-token')
  })

  it('rejects malformed topic lists without calling GitHub', async () => {
    const request = new Request('http://localhost/api/github/repos/octo/app/topics', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names: ['Not Valid'] }),
    })
    const response = await githubProxy(request)
    expect(response.status).toBe(400)
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('forwards only explicit archive=true patches', async () => {
    const invalid = await githubProxy(new Request('http://localhost/api/github/repos/octo/app', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: false }) }))
    expect(invalid.status).toBe(400)
    expect(fetchUpstream).not.toHaveBeenCalled()
    const archive = await githubProxy(new Request('http://localhost/api/github/repos/octo/app', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) }))
    expect(archive.status).toBe(200)
    expect(fetchUpstream.mock.calls.at(-1)?.[1]?.method).toBe('PATCH')
    const body = fetchUpstream.mock.calls.at(-1)?.[1]?.body as ArrayBuffer
    expect(new TextDecoder().decode(body)).toBe(JSON.stringify({ archived: true }))
  })

  it('allows deletion only at the repository root path', async () => {
    const deletion = await githubProxy(new Request('http://localhost/api/github/repos/octo/app', { method: 'DELETE' }))
    expect(deletion.status).toBe(200)
    expect(fetchUpstream).toHaveBeenCalledOnce()
    expect(fetchUpstream.mock.calls[0][1]?.method).toBe('DELETE')
    fetchUpstream.mockClear()
    const nested = await githubProxy(new Request('http://localhost/api/github/repos/octo/app/topics', { method: 'DELETE' }))
    expect(nested.status).toBe(404)
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated writes', async () => {
    authApi.getSession.mockResolvedValueOnce(null)
    const response = await githubProxy(new Request('http://localhost/api/github/repos/octo/app/topics', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names: ['safe-to-delete'] }),
    }))
    expect(response.status).toBe(401)
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('returns an explicit 401 when GitHub rejects a delete token', async () => {
    fetchUpstream.mockResolvedValueOnce(Response.json({ message: 'Bad credentials' }, { status: 401 }))
    const response = await githubProxy(new Request('http://localhost/api/github/repos/octo/app', { method: 'DELETE' }))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Your GitHub session expired because its authorization was revoked. Sign in again.' })
  })
})
