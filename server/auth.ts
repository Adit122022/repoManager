import { betterAuth } from 'better-auth'
import { dash } from '@better-auth/infra'

const clientId = process.env.GITHUB_CLIENT_ID
const clientSecret = process.env.GITHUB_CLIENT_SECRET
const secret = process.env.BETTER_AUTH_SECRET
const baseURL = process.env.BETTER_AUTH_URL
const infrastructureApiKey = process.env.BETTER_AUTH_API_KEY

if (!clientId || !clientSecret || !secret || !baseURL) {
  throw new Error('Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, BETTER_AUTH_SECRET, and BETTER_AUTH_URL in the server environment.')
}

export const auth = betterAuth({
  baseURL,
  secret,
  socialProviders: {
    github: {
      clientId,
      clientSecret,
      scope: ['repo', 'user:email'],
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 7 * 24 * 60 * 60,
      strategy: 'jwe',
      refreshCache: true,
    },
  },
  account: {
    storeStateStrategy: 'cookie',
    storeAccountCookie: true,
  },
  // Infrastructure is optional for local development. Add the plugin when its
  // server-only key is configured (for example, in the Vercel deployment).
  plugins: infrastructureApiKey ? [dash({ apiKey: infrastructureApiKey })] : [],
})
