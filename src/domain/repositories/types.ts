export type Repository = {
  id: string; name: string; nameWithOwner: string; description: string | null; url: string; homepageUrl: string | null
  updatedAt: string; stargazerCount: number; isArchived: boolean; isPrivate: boolean
  primaryLanguage: { name: string; color: string } | null
  repositoryTopics: { nodes: { topic: { name: string } }[] }
  licenseInfo: { name: string; spdxId: string | null } | null
  readme: { id: string } | null; readmeMd: { id: string } | null
}
export type Viewer = { login: string; name: string | null; avatarUrl: string }
