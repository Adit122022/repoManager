import { create } from 'zustand'
import type { Repository, Viewer } from '../../domain/repositories/types'

export type TriageDecision = 'keep' | 'archive' | 'delete-candidate'
const triagePrefix = 'repo-manager:triage:'

type RepoState = {
  repos: Repository[]; viewer: Viewer | null; loading: boolean; error: string | null
  decisions: Record<string, TriageDecision>
  setRepos: (repos: Repository[], viewer: Viewer) => void; setLoading: (loading: boolean) => void
  setError: (error: string | null) => void; updateTopics: (id: string, names: string[]) => void
  hydrateTriage: (login: string) => void; setDecision: (repoId: string, decision: TriageDecision | '') => void
  markArchived: (repoId: string) => void; removeRepository: (repoId: string) => void; clear: () => void
}

export const useRepoStore = create<RepoState>((set, get) => ({
  repos: [], viewer: null, loading: false, error: null, decisions: {},
  setRepos: (repos, viewer) => set({ repos, viewer, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  updateTopics: (id, names) => set(state => ({ repos: state.repos.map(repo => repo.id === id ? { ...repo, repositoryTopics: { nodes: names.map(name => ({ topic: { name } })) } } : repo) })),
  hydrateTriage: (login) => {
    try {
      const raw = localStorage.getItem(`${triagePrefix}${login}`)
      const parsed = raw ? JSON.parse(raw) as Record<string, TriageDecision> : {}
      set({ decisions: parsed && typeof parsed === 'object' ? parsed : {} })
    } catch { set({ decisions: {} }) }
  },
  setDecision: (repoId, decision) => {
    const decisions = { ...get().decisions }
    if (decision) decisions[repoId] = decision
    else delete decisions[repoId]
    set({ decisions })
    try {
      const login = get().viewer?.login
      if (login) localStorage.setItem(`${triagePrefix}${login}`, JSON.stringify(decisions))
    } catch { /* storage may be disabled; triage still works for this session */ }
  },
  markArchived: (repoId) => set(state => ({ repos: state.repos.map(repo => repo.id === repoId ? { ...repo, isArchived: true } : repo) })),
  removeRepository: (repoId) => {
    const decisions = { ...get().decisions }
    delete decisions[repoId]
    set(state => ({ repos: state.repos.filter(repo => repo.id !== repoId), decisions }))
    try {
      const login = get().viewer?.login
      if (login) localStorage.setItem(`${triagePrefix}${login}`, JSON.stringify(decisions))
    } catch { /* the deletion completed even if local storage is unavailable */ }
  },
  clear: () => set({ repos: [], viewer: null, error: null, loading: false, decisions: {} }),
}))
