import { describe, expect, it, vi } from 'vitest'
import { useRepoStore } from '../src/presentation/state/repository-store'
import type { Repository } from '../src/domain/repositories/types'

const repo: Repository = {
  id: 'repo-id', name: 'app', nameWithOwner: 'octo/app', description: null, url: 'https://github.com/octo/app', homepageUrl: null,
  updatedAt: '2026-01-01T00:00:00Z', stargazerCount: 0, isArchived: false, isPrivate: false,
  primaryLanguage: null, repositoryTopics: { nodes: [] }, licenseInfo: null, readme: null, readmeMd: null,
}

describe('triage state', () => {
  it('persists decisions per GitHub login and hydrates them after reload', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    })
    const store = useRepoStore.getState()
    store.setRepos([], { login: 'octo', name: 'Octo', avatarUrl: '' })
    store.setDecision('repo-id', 'archive')
    expect(data.get('repo-manager:triage:octo')).toBe(JSON.stringify({ 'repo-id': 'archive' }))

    useRepoStore.setState({ decisions: {} })
    useRepoStore.getState().hydrateTriage('octo')
    expect(useRepoStore.getState().decisions['repo-id']).toBe('archive')
    vi.unstubAllGlobals()
  })

  it('updates archived status locally and removes deleted repositories without a refetch', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    })
    const store = useRepoStore.getState()
    store.setRepos([repo], { login: 'octo', name: 'Octo', avatarUrl: '' })
    store.setDecision(repo.id, 'archive')
    useRepoStore.getState().markArchived(repo.id)
    expect(useRepoStore.getState().repos[0].isArchived).toBe(true)
    useRepoStore.getState().removeRepository(repo.id)
    expect(useRepoStore.getState().repos).toHaveLength(0)
    expect(useRepoStore.getState().decisions[repo.id]).toBeUndefined()
    vi.unstubAllGlobals()
  })
})
