import { create } from 'zustand'
import type { Repository, Viewer } from '../../domain/repositories/types'
type RepoState = {
  repos: Repository[]; viewer: Viewer | null; loading: boolean; error: string | null
  setRepos: (repos: Repository[], viewer: Viewer) => void; setLoading: (loading: boolean) => void
  setError: (error: string | null) => void; updateDescription: (repoId: string, description: string) => void; clear: () => void
}
export const useRepoStore = create<RepoState>((set) => ({
  repos: [], viewer: null, loading: false, error: null,
  setRepos: (repos, viewer) => set({ repos, viewer, error: null }), setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  updateDescription: (repoId, description) => set(state => ({ repos: state.repos.map(repo => repo.id === repoId ? { ...repo, description } : repo) })),
  clear: () => set({ repos: [], viewer: null, error: null, loading: false }),
}))
