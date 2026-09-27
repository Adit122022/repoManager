import type { Repository } from '../../domain/repositories/types'
import type { RepositoryDescriptionPort } from '../ports/ai-ports'

export function createUpdateRepositoryDescription(github: RepositoryDescriptionPort) {
  return async (repo: Repository, description: string) => {
    const normalized = description.trim().replace(/\s+/g, ' ')
    if (!normalized) throw new Error('A repository description cannot be empty.')
    if (normalized.length > 350) throw new Error('GitHub descriptions must be 350 characters or fewer.')
    await github.updateDescription(repo, normalized)
    return normalized
  }
}
