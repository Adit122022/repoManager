import { betterAuth } from 'better-auth'

const clientId = process.env.GITHUB_CLIENT_ID
const clientSecret = process.env.GITHUB_CLIENT_SECRET
const secret = process.env.BETTER_AUTH_SECRET
const baseURL = process.env.BETTER_AUTH_URL

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
})
