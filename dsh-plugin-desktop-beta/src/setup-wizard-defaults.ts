/**
 * First-run defaults committed when Desktop Setup is not opened.
 *
 * The launcher owns one product decision: whether a new Profile meets the
 * chooser or the shipped defaults. This module holds the default branch, and
 * it performs the same writes Desktop Setup's own Skip action performs, so a
 * Profile that never saw the chooser and one whose owner declined it persist
 * the same state. Every one of those choices stays editable in Desktop
 * settings afterwards.
 */

import type { DesktopMarketProvider } from './desktop-market.ts'
import {
  desktopProfilePreferencesFromSettings,
  writeDesktopProfilePreferences,
  type DesktopProfilePreferencesStateV1,
} from './profile-preferences.ts'
import { readDesktopSetupWizardSettings } from './setup-wizard-settings.ts'
import {
  completeOrSkipDesktopSetupWizard,
  type DesktopSetupWizardVersions,
} from './setup-wizard-state.ts'

/** Everything the default branch reads or records for one Profile. */
export interface DesktopFirstRunDefaultsInput {
  /** Electron user-data directory holding both durable state markers. */
  readonly userDataDir: string
  /** Profile whose preferences and Setup marker this commit owns. */
  readonly profileDir: string
  /** Prepared settings document; absent sections resolve to the shipped defaults. */
  readonly settingsDocument: string
  /** Market provider the launcher already selected for this generation. */
  readonly market: DesktopMarketProvider
  /** Installed versions recorded so this marker suppresses the next first run. */
  readonly versions: DesktopSetupWizardVersions
  /**
   * Re-compose the Profile after preferences changed, so the rest of this
   * launch composes the committed choices. The Profile directory stays the one
   * passed above: it derives from the Harness home and the profile name, which
   * preferences never move.
   */
  readonly reprepare: () => Promise<void>
}

/** Launcher facts that decide what one first run does. */
export interface DesktopFirstRunFacts {
  /** Whether this launch is the disposable Safe Mode generation. */
  readonly safeMode: boolean
  /** Whether this build exposes the Desktop Setup chooser at all. */
  readonly chooserEnabled: boolean
  /** Whether the Profile still has no Setup marker. */
  readonly setupRequired: boolean
  /**
   * Whether the Profile already holds usage evidence. Read only when the facts
   * above leave the question open: a corrupt release state makes this throw,
   * and that must never break a Safe Mode launch.
   * @returns whether any edition recorded use for this Profile.
   */
  readonly hasUsageHistory: () => boolean
}

/** What one first run does about Desktop Setup. */
export type DesktopFirstRunAction = 'skip-setup' | 'open-chooser' | 'commit-defaults'

/**
 * Decide what a first run does with Desktop Setup. Safe Mode and an
 * already-settled or already-used Profile take no action at all; the remaining
 * question is whether this build asks or commits.
 * @param facts - launch mode, build gate, marker state, and the history probe.
 * @returns the action the launcher takes.
 */
export function desktopFirstRunAction(facts: DesktopFirstRunFacts): DesktopFirstRunAction {
  if (facts.safeMode) return 'skip-setup'
  if (!facts.setupRequired) return 'skip-setup'
  if (facts.hasUsageHistory()) return 'skip-setup'
  return facts.chooserEnabled ? 'open-chooser' : 'commit-defaults'
}

/**
 * Commit the shipped first-run defaults for one Profile without opening
 * Desktop Setup. The settings document is left untouched: every value the
 * chooser would have written is already its default, and an absent document
 * resolves to that default in every reader.
 * @param input - Profile, settings document, market, versions, and re-composition hook.
 * @returns the preferences now persisted for the Profile.
 */
export async function commitDesktopFirstRunDefaults(
  input: DesktopFirstRunDefaultsInput,
): Promise<DesktopProfilePreferencesStateV1> {
  const settings = readDesktopSetupWizardSettings(input.settingsDocument)
  const preferences = await writeDesktopProfilePreferences(input.userDataDir, input.profileDir, {
    ...desktopProfilePreferencesFromSettings(settings, settings.notifications, input.market),
    aaEnabled: false,
  })
  await input.reprepare()
  // `completed`, not `skipped`: the launcher finished Setup with the shipped
  // defaults. The marker is read as usage evidence by channel admission, where
  // "this Profile left first run" is the fact that matters, and calling it a
  // skip would report a user decision that never happened.
  await completeOrSkipDesktopSetupWizard(input.userDataDir, input.profileDir, 'completed', input.versions)
  return preferences
}
