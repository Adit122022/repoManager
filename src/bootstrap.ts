import { createAnalyzeRepositories } from './application/use-cases/analyze-repositories'
import { LocalAnalysisCache } from './infrastructure/storage/local-analysis-cache'
import { GitHubRepositoryAnalysisApi } from './infrastructure/github/repository-analysis-api'
import { beginDeviceFlow, clearToken, fetchRepositories, getToken, hasClientId, pollDeviceToken } from './infrastructure/github/github-api'

const repositoryAnalysisApi = new GitHubRepositoryAnalysisApi()
const analyzeRepositories = createAnalyzeRepositories(new LocalAnalysisCache(), repositoryAnalysisApi)

/** Composition root: concrete adapters are assembled here and passed to the UI. */
export const appServices = { beginDeviceFlow, clearToken, fetchRepositories, getToken, hasClientId, pollDeviceToken, analyzeRepositories }
