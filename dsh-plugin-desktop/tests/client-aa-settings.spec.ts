// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopSettingsSection, type DesktopSettingsSectionProps } from '../src/client/DesktopSettingsSection.tsx'
import { zh } from '../src/client/desktop-settings-locales.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined

function scope(value: unknown) {
  const snapshot = { status: 'ready', writable: true, value }
  return { getSnapshot: () => snapshot, subscribe: () => () => {} }
}

async function mount(
  selectAa: (enabled: boolean) => Promise<{ accepted: true; restartRequired: boolean }>,
  aa?: { requested: boolean; effective: boolean },
) {
  // An absent `aa` field is how a build with a closed remote-control gate
  // reaches the renderer, so `undefined` must stay distinguishable here.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    api: {
      read: async () => ({ current: 'desktop', profiles: [],
        ...(aa === undefined ? {} : { aa }),
        market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: false },
        web: { localUrl: '', lanUrls: [], lanState: 'inactive', lanError: null, lanCaFingerprint: null, lanCaUrls: [] },
      }), selectAa,
    },
    platform: 'darwin', initialMode: 'compatibility', micaSupported: false, setMode: async () => {},
    desktopSettings: scope({ mode: 'compatibility', openBrowser: false, networkExposure: 'loopback', macosMaterial: 'off', windowsMaterial: 'off' }),
    notificationSettings: scope({ enabled: false }),
  } as unknown as DesktopSettingsSectionProps
  await act(async () => { root!.render(createElement(DesktopSettingsSection, props)) })
  return container.querySelector('[aria-labelledby="dsh-desktop-aa-title"]')
}

function enabledChoice(section: Element): HTMLElement {
  return section.querySelectorAll<HTMLElement>('[role="radio"]')[1]!
}

/** Mount with AA state present and fail loudly when the group is missing. */
async function mountAaSection(
  selectAa: (enabled: boolean) => Promise<{ accepted: true; restartRequired: boolean }>,
  aa: { requested: boolean; effective: boolean },
): Promise<Element> {
  const section = await mount(selectAa, aa)
  if (section === null) throw new Error('expected the remote-control group to render')
  return section
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

describe('AA settings clicks', () => {
  it('shows a failed bundle load and allows retrying the already selected option', async () => {
    const select = vi.fn(async () => ({ accepted: true as const, restartRequired: true }))
    const section = await mountAaSection(select, { requested: true, effective: false })
    expect(section.textContent).toContain(zh.aaLoadFailed)
    expect(enabledChoice(section).textContent).toContain(zh.retryAa)
    await act(async () => { enabledChoice(section).click() })
    expect(select).toHaveBeenCalledWith(true)
  })

  it('shows pending feedback next to the cards, then selects AA only after persistence succeeds', async () => {
    let complete!: (value: { accepted: true; restartRequired: boolean }) => void
    const select = vi.fn(() => new Promise<{ accepted: true; restartRequired: boolean }>(resolve => { complete = resolve }))
    const section = await mountAaSection(select, { requested: false, effective: false })
    await act(async () => { enabledChoice(section).click() })
    expect(select).toHaveBeenCalledWith(true)
    expect(section.querySelector('[role="status"]')?.textContent).toBe(zh.aaSaving)
    expect(enabledChoice(section).getAttribute('aria-checked')).toBe('false')
    await act(async () => { complete({ accepted: true, restartRequired: true }) })
    expect(enabledChoice(section).getAttribute('aria-checked')).toBe('true')
    expect(section.querySelector('[role="status"]')?.textContent).toBe(zh.restarting)
    expect(section.textContent).toContain(zh.aaEnabledBody)
  })

  it('shows a local error on rejection and lets the same card retry', async () => {
    const select = vi.fn().mockRejectedValueOnce(new Error('preference validation failed'))
      .mockResolvedValueOnce({ accepted: true, restartRequired: true })
    const section = await mountAaSection(select, { requested: false, effective: false })
    await act(async () => { enabledChoice(section).click() })
    expect(section.querySelector('[role="alert"]')?.textContent).toBe(zh.aaSaveFailed)
    expect(enabledChoice(section).getAttribute('aria-checked')).toBe('false')
    await act(async () => { enabledChoice(section).click() })
    expect(select).toHaveBeenCalledTimes(2)
    expect(section.querySelector('[role="alert"]')).toBeNull()
    expect(enabledChoice(section).getAttribute('aria-checked')).toBe('true')
  })

  it('renders no remote-control group when the Host reports no AA state', async () => {
    const select = vi.fn(async () => ({ accepted: true as const, restartRequired: true }))
    const section = await mount(select, undefined)
    await vi.waitFor(() => { expect(container!.textContent).toContain(zh.presentationTitle) })
    expect(section).toBeNull()
    expect(container!.querySelector('[aria-labelledby="dsh-desktop-aa-title"]')).toBeNull()
    expect(container!.textContent).not.toContain(zh.aaTitle)
  })
})
