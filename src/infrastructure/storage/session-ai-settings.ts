import type { AiSettingsPort } from '../../application/ports/ai-ports'
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, type ClaudeModel } from '../../domain/ai/claude-models'

const API_KEY = 'repo-manager:anthropic-api-key'
const MODEL = 'repo-manager:anthropic-model'

export class SessionAiSettings implements AiSettingsPort {
  getApiKey() { return sessionStorage.getItem(API_KEY) || '' }
  saveApiKey(apiKey: string) { sessionStorage.setItem(API_KEY, apiKey.trim()) }
  clearApiKey() { sessionStorage.removeItem(API_KEY) }
  getModel(): ClaudeModel {
    const saved = sessionStorage.getItem(MODEL)
    return CLAUDE_MODELS.some(option => option.id === saved) ? saved as ClaudeModel : DEFAULT_CLAUDE_MODEL
  }
  saveModel(model: ClaudeModel) { sessionStorage.setItem(MODEL, model) }
}
