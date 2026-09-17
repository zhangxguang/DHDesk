// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  applyDesktopChannelOnboarding,
  DESKTOP_CHANNEL_CREDENTIAL_REFERENCE,
  DESKTOP_CHANNEL_ONBOARDING_LOCALE_NAMESPACE,
  DESKTOP_CHANNEL_ONBOARDING_ORDER,
  DESKTOP_CHANNEL_ONBOARDING_STEP_ID,
  DesktopChannelOnboarding,
  desktopChannelOnboardingReadiness,
  OFFICIAL_ROUTE_CREDENTIAL_REFERENCE,
  readWithinBound,
  type DesktopChannelKeyState,
  type DesktopChannelOnboardingProps,
} from '../src/client/channel-onboarding.tsx'
import { zh } from '../src/client/channel-onboarding-locales.ts'

const t = (key: keyof typeof zh): string => zh[key]

let root: Root | undefined
let container: HTMLDivElement | undefined

/** Mount the step with the injected capabilities a registration supplies. */
async function mount(options: {
  read?: () => Promise<DesktopChannelKeyState | undefined>
  store?: (value: string) => Promise<string | undefined>
  select?: () => Promise<string | undefined>
} = {}): Promise<{
  complete: ReturnType<typeof vi.fn>
  store: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  container: HTMLElement
}> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const complete = vi.fn()
  const store = vi.fn(options.store ?? (async () => undefined))
  const select = vi.fn(options.select ?? (async () => undefined))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const props = {
    stepId: DESKTOP_CHANNEL_ONBOARDING_STEP_ID,
    complete,
    openSection: vi.fn(),
    readKeyState: options.read ?? (async () => ({ channel: false, official: false })),
    storeKey: store,
    selectDefaultModel: select,
    t,
  } as unknown as DesktopChannelOnboardingProps
  await act(async () => { root!.render(createElement(DesktopChannelOnboarding, props)) })
  return { complete, store, select, container }
}

function field(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#dsh-desktop-channel-key-field`)!
}

function dialog(): Element | null {
  return document.querySelector('[role="dialog"]')
}

/** Type into the key field the way a user edit reaches the controlled input. */
async function type(text: string): Promise<void> {
  await act(async () => {
    const input = field()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** The save control by role class: its label changes while a write is pending. */
function saveButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.dshDesktopChannelOnboardingSave')!
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find(candidate => candidate.textContent === label)
  if (match === undefined) throw new Error(`no button labelled ${label}`)
  return match
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('desktop channel first-run readiness', () => {
  it('prompts only while neither first-run reference is configured', () => {
    expect(desktopChannelOnboardingReadiness({ channel: false, official: false })).toBe('prompt')
  })

  it('settles once the shipped channel key exists', () => {
    expect(desktopChannelOnboardingReadiness({ channel: true, official: false })).toBe('settled')
  })

  it('settles when the user already stored the official route key', () => {
    expect(desktopChannelOnboardingReadiness({ channel: false, official: true })).toBe('settled')
  })

  it('settles rather than blocking a first run on an unreadable credential seam', () => {
    expect(desktopChannelOnboardingReadiness(undefined)).toBe('settled')
  })
})

describe('desktop channel first-run step', () => {
  it('prompts while no first-run route can serve a request', async () => {
    await mount()
    expect(dialog()?.textContent).toContain(zh.title)
    expect(field().type).toBe('password')
    // An empty field cannot be saved; only skipping is available.
    expect(button(zh.save).disabled).toBe(true)
  })

  it('stores the key, moves the default onto the route, then hands the ledger on', async () => {
    const calls: string[] = []
    const { complete, select, store } = await mount({
      store: async () => { calls.push('store'); return undefined },
      select: async () => { calls.push('select'); return undefined },
    })
    await type('sk-zhuzi')
    await act(async () => { button(zh.save).click() })
    expect(store).toHaveBeenCalledWith('sk-zhuzi')
    expect(select).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['store', 'select'])
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('keeps the dialog open when the default selection cannot be moved', async () => {
    const { complete, store } = await mount({ select: async () => 'settings document is read-only' })
    await type('sk-zhuzi')
    await act(async () => { button(zh.save).click() })
    expect(store).toHaveBeenCalledWith('sk-zhuzi')
    expect(complete).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('settings document is read-only')
  })

  it('stores a pasted key without its surrounding whitespace', async () => {
    const { complete, store } = await mount()
    await type('  sk-zhuzi\n')
    await act(async () => { button(zh.save).click() })
    expect(store).toHaveBeenCalledWith('sk-zhuzi')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('refuses a whitespace-only key instead of storing an unusable credential', async () => {
    const { complete, store } = await mount()
    await type('   ')
    expect(button(zh.save).disabled).toBe(true)
    await act(async () => { button(zh.save).click() })
    expect(store).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and reports the Host refusal when storing fails', async () => {
    const { complete } = await mount({ store: async () => 'credential store is read-only' })
    await type('sk-zhuzi')
    await act(async () => { button(zh.save).click() })
    expect(complete).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('credential store is read-only')
  })

  it('skips without storing anything, leaving the official step to prompt', async () => {
    const { complete, store } = await mount()
    await act(async () => { button(zh.skip).click() })
    expect(store).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('keeps Skip available while a save is in flight', async () => {
    let finish!: (value: string | undefined) => void
    const { complete } = await mount({
      store: () => new Promise<string | undefined>((resolve) => { finish = resolve }),
    })
    await type('sk-zhuzi')
    await act(async () => { button(zh.save).click() })
    expect(saveButton().disabled).toBe(true)
    expect(button(zh.skip).disabled).toBe(false)
    await act(async () => { button(zh.skip).click() })
    expect(complete).toHaveBeenCalledTimes(1)
    // The abandoned write settles afterwards without touching the step again.
    await act(async () => { finish(undefined) })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape while a save is in flight, then honours it', async () => {
    let finish!: (value: string | undefined) => void
    const { complete } = await mount({
      store: () => new Promise<string | undefined>((resolve) => { finish = resolve }),
    })
    await type('sk-zhuzi')
    await act(async () => { button(zh.save).click() })
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(complete).not.toHaveBeenCalled()
    await act(async () => { finish('credential store is read-only') })
    expect(complete).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('credential store is read-only')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('focuses the key field and describes it with the hint', async () => {
    await mount()
    const input = field()
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('autocomplete')).toBe('new-password')
    expect(input.getAttribute('aria-describedby')).toBe('dsh-desktop-channel-onboarding-hint')
    expect(document.getElementById('dsh-desktop-channel-onboarding-hint')).not.toBeNull()
  })

  it('adds the failure to the field description while it shows', async () => {
    const { complete } = await mount({ store: async () => 'read-only' })
    await type('sk-zhuzi')
    await act(async () => { button(zh.save).click() })
    expect(complete).not.toHaveBeenCalled()
    expect(field().getAttribute('aria-describedby'))
      .toBe('dsh-desktop-channel-onboarding-hint dsh-desktop-channel-onboarding-failure')
  })

  it('settles without painting once a first-run key is already stored', async () => {
    const { complete } = await mount({ read: async () => ({ channel: true, official: false }) })
    expect(dialog()).toBeNull()
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('settles when the credential seam cannot be read', async () => {
    const { complete } = await mount({ read: async () => { throw new Error('offline') } })
    expect(dialog()).toBeNull()
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

describe('desktop channel first-run registration', () => {
  it('registers one step between the upstream notice and the official route step', async () => {
    const inject = vi.fn((_name: string, callback: () => void) => { callback() })
    const register = vi.fn()
    const describe = vi.fn(async () => ({
      ok: true as const,
      value: {
        [DESKTOP_CHANNEL_CREDENTIAL_REFERENCE]: { configured: false },
        [OFFICIAL_ROUTE_CREDENTIAL_REFERENCE]: { configured: false },
      },
    }))
    const set = vi.fn(async () => ({ ok: true as const, value: {} }))
    const bind = vi.fn(() => t)
    const localeRegister = vi.fn(() => () => {})
    const ctx = {
      remote: { credentials: { describe, set } },
      locale: { bind, register: localeRegister },
      effect: vi.fn((callback: () => () => void) => { callback() }),
      slots: { inject, register },
    } as unknown as ClientContext

    applyDesktopChannelOnboarding(ctx)

    expect(localeRegister).toHaveBeenCalledWith(DESKTOP_CHANNEL_ONBOARDING_LOCALE_NAMESPACE, expect.anything())
    expect(inject).toHaveBeenCalledWith('settings.onboarding', expect.any(Function))
    const [options, component] = register.mock.calls[0] as unknown as [
      { id: string; order: number; inject: () => { readKeyState: () => Promise<unknown>; storeKey: (v: string) => Promise<unknown> } },
      unknown,
    ]
    expect(options).toMatchObject({
      name: 'settings.onboarding',
      id: DESKTOP_CHANNEL_ONBOARDING_STEP_ID,
      order: DESKTOP_CHANNEL_ONBOARDING_ORDER,
      locale: DESKTOP_CHANNEL_ONBOARDING_LOCALE_NAMESPACE,
    })
    expect(component).toBe(DesktopChannelOnboarding)
    // The order must sit strictly between the upstream notice and the official step.
    expect(DESKTOP_CHANNEL_ONBOARDING_ORDER).toBeGreaterThan(-100)
    expect(DESKTOP_CHANNEL_ONBOARDING_ORDER).toBeLessThan(0)

    const injected = options.inject()
    await expect(injected.readKeyState()).resolves.toEqual({ channel: false, official: false })
    await expect(injected.storeKey('sk-zhuzi')).resolves.toBeUndefined()
    expect(describe).toHaveBeenCalledWith([
      DESKTOP_CHANNEL_CREDENTIAL_REFERENCE,
      OFFICIAL_ROUTE_CREDENTIAL_REFERENCE,
    ])
    expect(set).toHaveBeenCalledWith(DESKTOP_CHANNEL_CREDENTIAL_REFERENCE, 'sk-zhuzi')
  })

  it('reports an unreadable seam and a refused store instead of throwing', async () => {
    const register = vi.fn()
    const ctx = {
      remote: {
        credentials: {
          describe: async () => ({ ok: false as const, error: { message: 'offline' } }),
          set: async () => ({ ok: false as const, error: { message: 'read-only' } }),
        },
      },
      locale: { bind: () => t, register: () => () => {} },
      effect: vi.fn((callback: () => () => void) => { callback() }),
      slots: { inject: vi.fn((_name: string, callback: () => void) => { callback() }), register },
    } as unknown as ClientContext

    applyDesktopChannelOnboarding(ctx)

    const [options] = register.mock.calls[0] as unknown as [
      { inject: () => { readKeyState: () => Promise<unknown>; storeKey: (v: string) => Promise<unknown> } },
    ]
    const injected = options.inject()
    await expect(injected.readKeyState()).resolves.toBeUndefined()
    await expect(injected.storeKey('sk-zhuzi')).resolves.toBe('read-only')
  })
})

describe('shipped channel step host reads', () => {
  it('returns the value a read produces', async () => {
    await expect(readWithinBound(async () => 'value', 50)).resolves.toBe('value')
  })

  it('reports a refused read as no answer', async () => {
    await expect(readWithinBound(async () => { throw new Error('offline') }, 50)).resolves.toBeUndefined()
  })

  it('bounds a read that never settles', async () => {
    await expect(readWithinBound(() => new Promise<string>(() => {}), 5)).resolves.toBeUndefined()
  })

  it('settles a step whose read never answers, instead of stalling the chain', async () => {
    vi.useFakeTimers()
    try {
      const { complete } = await mount({ read: () => new Promise(() => {}) })
      // Nothing paints while the step decides, and the chain is still waiting.
      expect(dialog()).toBeNull()
      expect(complete).not.toHaveBeenCalled()
      await act(async () => { vi.advanceTimersByTime(10_000) })
      expect(complete).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
