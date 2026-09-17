import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_SETUP_CHOOSER_ENABLED } from '../src/desktop-features.ts'
import { readDesktopProfilePreferences } from '../src/profile-preferences.ts'
import { commitDesktopFirstRunDefaults, desktopFirstRunAction } from '../src/setup-wizard-defaults.ts'
import { readDesktopSetupWizardSettings } from '../src/setup-wizard-settings.ts'
import {
  desktopSetupWizardRequired,
  desktopSetupWizardStateConstants,
  readDesktopSetupWizardState,
  type DesktopSetupWizardVersions,
} from '../src/setup-wizard-state.ts'

const temporaryDirectories: string[] = []
const VERSIONS: DesktopSetupWizardVersions = Object.freeze({
  desktopVersion: '2.0.3',
  dshVersion: '0.1.6-alpha.1',
  setupRevision: desktopSetupWizardStateConstants.setupRevision,
})

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), label))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

/** One first run over a Profile that has never been configured. */
async function firstRun(options: { market?: 'disabled' | 'community-market' } = {}) {
  const userData = temporaryDirectory('dsh-first-run-userdata-')
  const profileDir = temporaryDirectory('dsh-first-run-profile-')
  const settingsDocument = join(temporaryDirectory('dsh-first-run-home-'), 'settings.yaml')
  const reprepare = vi.fn(async () => {})
  const preferences = await commitDesktopFirstRunDefaults({
    userDataDir: userData,
    profileDir,
    settingsDocument,
    market: options.market ?? 'disabled',
    versions: VERSIONS,
    reprepare,
  })
  return { userData, profileDir, settingsDocument, reprepare, preferences }
}

describe('Desktop first-run defaults', () => {
  it('persists the shipped settings defaults with the phone connection off', async () => {
    const { preferences, profileDir, userData } = await firstRun()
    const settings = readDesktopSetupWizardSettings(join(userData, 'unused.yaml'))
    expect(preferences).toMatchObject({
      mode: settings.mode,
      openBrowser: settings.openBrowser,
      networkExposure: settings.networkExposure,
      notifications: settings.notifications,
      aaEnabled: false,
    })
    // The same values the reader would resolve for an untouched Profile.
    expect(readDesktopProfilePreferences(userData, profileDir)).toMatchObject(preferences)
  })

  it('carries the launcher-selected Market provider into the Profile preferences', async () => {
    const { preferences } = await firstRun({ market: 'community-market' })
    expect(preferences.market).toBe('community-market')
  })

  it('re-composes the Profile between the preferences write and the marker', async () => {
    const order: string[] = []
    const userData = temporaryDirectory('dsh-first-run-order-userdata-')
    const profileDir = temporaryDirectory('dsh-first-run-order-profile-')
    await commitDesktopFirstRunDefaults({
      userDataDir: userData,
      profileDir,
      settingsDocument: join(temporaryDirectory('dsh-first-run-order-home-'), 'settings.yaml'),
      market: 'disabled',
      versions: VERSIONS,
      reprepare: async () => {
        // Preferences are durable by the time composition re-reads them.
        expect(readDesktopProfilePreferences(userData, profileDir)).toBeDefined()
        order.push('reprepare')
      },
    })
    // The Profile directory derives from the Harness home and the profile name,
    // so preferences cannot move it: both writes name the same directory.
    expect(order).toEqual(['reprepare'])
    expect(readDesktopSetupWizardState(userData, profileDir)).toMatchObject({
      outcome: 'skipped',
      ...VERSIONS,
    })
  })

  it('keeps a customized settings document and commits its values as the choices', async () => {
    const userData = temporaryDirectory('dsh-first-run-custom-userdata-')
    const profileDir = temporaryDirectory('dsh-first-run-custom-profile-')
    const home = temporaryDirectory('dsh-first-run-custom-home-')
    const settingsDocument = join(home, 'settings.yaml')
    // LAN exposure without browser access is the reader's own normalization, so
    // the committed preference is loopback while the document keeps saying lan.
    const original = 'dsh-desktop:\n  mode: advanced\n  networkExposure: lan\n'
    writeFileSync(settingsDocument, original)
    const preferences = await commitDesktopFirstRunDefaults({
      userDataDir: userData,
      profileDir,
      settingsDocument,
      market: 'disabled',
      versions: VERSIONS,
      reprepare: async () => {},
    })
    // Committing defaults must never rewrite a document that already carries
    // choices; the Profile inherits them instead.
    expect(readFileSync(settingsDocument, 'utf8')).toBe(original)
    expect(preferences).toMatchObject({ mode: 'advanced', networkExposure: 'loopback', aaEnabled: false })
    expect(readDesktopProfilePreferences(userData, profileDir)).toMatchObject({ mode: 'advanced' })
  })

  it('suppresses the next first run for this Profile only', async () => {
    const { userData, profileDir } = await firstRun()
    // Setup is a one-time Profile decision: recorded versions are diagnostic
    // only, so a later build never re-opens the chooser for this Profile.
    expect(desktopSetupWizardRequired(readDesktopSetupWizardState(userData, profileDir), VERSIONS)).toBe(false)
    expect(desktopSetupWizardRequired(readDesktopSetupWizardState(userData, profileDir), {
      ...VERSIONS,
      dshVersion: '0.1.7-alpha.1',
    })).toBe(false)
    // A Profile with no marker is still a first run.
    expect(desktopSetupWizardRequired(
      readDesktopSetupWizardState(userData, temporaryDirectory('dsh-first-run-other-profile-')),
      VERSIONS,
    )).toBe(true)
  })

  it('records the marker once, so repeating the commit keeps one outcome', async () => {
    const { userData, profileDir, settingsDocument, preferences } = await firstRun()
    await commitDesktopFirstRunDefaults({
      userDataDir: userData,
      profileDir,
      settingsDocument,
      market: 'disabled',
      versions: VERSIONS,
      reprepare: async () => {},
    })
    // The repeat re-writes the same choices; only its timestamp moves.
    expect(readDesktopProfilePreferences(userData, profileDir)).toMatchObject({
      mode: preferences.mode,
      openBrowser: preferences.openBrowser,
      networkExposure: preferences.networkExposure,
      notifications: preferences.notifications,
      market: preferences.market,
      aaEnabled: preferences.aaEnabled,
    })
    expect(readDesktopSetupWizardState(userData, profileDir)?.outcome).toBe('skipped')
  })
})

describe('desktop first-run decision', () => {
  const open = { safeMode: false, chooserEnabled: true, setupRequired: true }

  it('commits the shipped defaults while the chooser gate is closed', () => {
    expect(desktopFirstRunAction({ ...open, chooserEnabled: false, hasUsageHistory: () => false }))
      .toBe('commit-defaults')
  })

  it('opens the chooser only when the build exposes it', () => {
    expect(desktopFirstRunAction({ ...open, hasUsageHistory: () => false })).toBe('open-chooser')
  })

  it('decides Safe Mode and settled Profiles without probing usage history', () => {
    const history = vi.fn(() => true)
    expect(desktopFirstRunAction({ ...open, safeMode: true, hasUsageHistory: history })).toBe('skip-setup')
    expect(desktopFirstRunAction({ ...open, setupRequired: false, hasUsageHistory: history })).toBe('skip-setup')
    expect(history).not.toHaveBeenCalled()
  })

  it('leaves a Profile that already holds usage evidence alone', () => {
    const history = vi.fn(() => true)
    expect(desktopFirstRunAction({ ...open, hasUsageHistory: history })).toBe('skip-setup')
    expect(history).toHaveBeenCalledTimes(1)
  })

  it('ships the chooser gate closed', async () => {
    vi.stubEnv('DSH_FEATURE_SETUP_CHOOSER', '')
    vi.resetModules()
    try {
      const features = await import('../src/desktop-features.ts')
      expect(features.DESKTOP_SETUP_CHOOSER_ENABLED).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('opens the gate for one process through its documented override', async () => {
    vi.stubEnv('DSH_FEATURE_SETUP_CHOOSER', '1')
    vi.resetModules()
    try {
      const features = await import('../src/desktop-features.ts')
      expect(features.DESKTOP_SETUP_CHOOSER_ENABLED).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('keeps the shipped gate in step with the imported constant', () => {
    expect(DESKTOP_SETUP_CHOOSER_ENABLED).toBe(process.env.DSH_FEATURE_SETUP_CHOOSER === '1')
  })
})
