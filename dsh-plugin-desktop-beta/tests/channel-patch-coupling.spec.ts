import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE,
  DESKTOP_CHANNEL_CREDENTIAL_REFERENCE,
  DESKTOP_CHANNEL_MODEL,
  DESKTOP_CHANNEL_PROVIDER,
} from '../src/client/channel-onboarding.tsx'

const packageRoot = new URL('../', import.meta.url)

interface PatchEntry {
  readonly id?: string
  readonly config?: Record<string, unknown>
}

// The patch dialect carries `!!js` expressions the Loader evaluates; this spec
// reads only ids and config values, so the tag is stripped instead of taught.
const patch = parseYaml(
  readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8').replaceAll('!!js ', ''),
) as PatchEntry[]

/** One shipped provider profile as the patch declares it. */
function shippedRoute(provider: string): { apiKeyEnv?: string; baseURL?: string; models?: Array<{ id: string }> } | undefined {
  const providers = patch.find(entry => entry.id === 'llm-pi-ai')?.config?.providers
  return (providers as Record<string, { apiKeyEnv?: string; baseURL?: string; models?: Array<{ id: string }> }> | undefined)?.[provider]
}

describe('shipped channel constants against the composition patch', () => {
  it('names the route, credential reference, and model the patch actually ships', () => {
    const route = shippedRoute(DESKTOP_CHANNEL_PROVIDER)
    // A rename on either side would leave the first-run step storing a key no
    // route resolves, or selecting a route that does not exist.
    expect(route).toBeDefined()
    expect(route?.apiKeyEnv).toBe(DESKTOP_CHANNEL_CREDENTIAL_REFERENCE)
    expect(route?.models?.map(model => model.id)).toContain(DESKTOP_CHANNEL_MODEL)
  })

  it('leaves the default selection to the first-run step, not to composition', () => {
    // Composition keeps the upstream default so a user who skips the step
    // still starts on a route the official step can make servable; the step
    // moves the default only once the shipped key exists.
    expect(patch.some(entry => entry.id === AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE)).toBe(false)
  })
})
