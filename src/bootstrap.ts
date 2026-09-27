import { createAnalyzeRepositories } from './application/use-cases/analyze-repositories'
import { LocalAnalysisCache } from './infrastructure/storage/local-analysis-cache'
import { SessionAiSettings } from './infrastructure/storage/session-ai-settings'
import { GitHubRepositoryAnalysisApi } from './infrastructure/github/repository-analysis-api'
import { beginDeviceFlow, clearToken, fetchRepositories, fetchSummaryContext, getToken, hasClientId, patchRepositoryDescription, pollDeviceToken } from './infrastructure/github/github-api'
import { LangChainClaudeSummaryClient } from './infrastructure/anthropic/langchain-summary-client'
import { createGenerateRepositorySummary } from './application/use-cases/generate-repository-summary'
import { createUpdateRepositoryDescription } from './application/use-cases/update-repository-description'

const repositoryAnalysisApi = new GitHubRepositoryAnalysisApi()
const analyzeRepositories = createAnalyzeRepositories(new LocalAnalysisCache(), repositoryAnalysisApi)
const aiSettings = new SessionAiSettings()
const generateRepositorySummary = createGenerateRepositorySummary({ getContext: fetchSummaryContext }, new LangChainClaudeSummaryClient())
const updateRepositoryDescription = createUpdateRepositoryDescription({ updateDescription: patchRepositoryDescription })

/** Composition root: concrete adapters are assembled here and passed to the UI. */
export const appServices = {
  beginDeviceFlow, clearToken, fetchRepositories, getToken, hasClientId, pollDeviceToken, analyzeRepositories,
  getAiApiKey: () => aiSettings.getApiKey(), saveAiApiKey: (key: string) => aiSettings.saveApiKey(key),
  clearAiApiKey: () => aiSettings.clearApiKey(), getAiModel: () => aiSettings.getModel(),
  saveAiModel: (model: Parameters<typeof aiSettings.saveModel>[0]) => aiSettings.saveModel(model),
  generateRepositorySummary, updateRepositoryDescription,
}
