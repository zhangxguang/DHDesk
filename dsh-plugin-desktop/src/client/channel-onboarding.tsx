/**
 * First-run step for the model channel Desktop ships as its default route.
 *
 * The step asks for the shipped channel's credential before the official route
 * gets its own step, and registers between them in the `settings.onboarding`
 * list. Storing the key is what ends the whole first run: the official step
 * reads every configured provider and completes itself without painting once
 * any route can serve a request. A user who skips this step still meets the
 * official prompt, so the fallback stays upstream's.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only convergence for the slot service and the settings shell that
// declares this step's seat.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type DesktopChannelOnboardingLocaleKey } from './channel-onboarding-locales.ts'

/** Credential reference the shipped channel profile resolves for each request. */
export const DESKTOP_CHANNEL_CREDENTIAL_REFERENCE = 'ZHUZI_API_KEY'

/** Official route's reference; a stored key there means the user already has a channel. */
export const OFFICIAL_ROUTE_CREDENTIAL_REFERENCE = 'DEEPSEEK_API_KEY'

/** Step id, unique within the `settings.onboarding` list slot. */
export const DESKTOP_CHANNEL_ONBOARDING_STEP_ID = 'desktop-channel-key'

/**
 * Step order. Upstream registers its notice at -100 and the official route's
 * step at 0; storing this channel's key between them is what makes the
 * official step observe a servable route and skip its own prompt.
 */
export const DESKTOP_CHANNEL_ONBOARDING_ORDER = -50

/** Locale namespace owned by the shipped route's first-run step. */
export const DESKTOP_CHANNEL_ONBOARDING_LOCALE_NAMESPACE = 'desktop.onboarding'

const STYLE_ID = 'dsh-desktop-channel-onboarding-styles'
const FIELD_ID = 'dsh-desktop-channel-key-field'
const TITLE_ID = 'dsh-desktop-channel-onboarding-title'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop-only first-run copy for the shipped channel's credential. */
    'desktop.onboarding': DesktopChannelOnboardingLocaleKey
  }
}

/** Which first-run credential references the seam already holds a value for. */
export interface DesktopChannelKeyState {
  /** The shipped channel's own reference, named by its composed provider profile. */
  readonly channel: boolean
  /** The official route's reference. */
  readonly official: boolean
}

/** What the shipped route's first-run step owes the user right now. */
export type DesktopChannelOnboardingReadiness = 'deciding' | 'prompt' | 'settled'

/**
 * Decide whether the shipped channel still owes the user a key prompt. The
 * step exists to leave the user with a servable route, so a stored key for
 * either reference settles it: the channel's own key means the shipped default
 * already works, and the official key means the user chose another route the
 * official step has already served. An unreadable credential seam settles the
 * step too — a first run must not be blocked by a surface that cannot store
 * the key anyway, and the Models page remains the diagnostic home.
 * @param keys - configured state per first-run reference, or undefined when unreadable.
 * @returns the step's readiness.
 */
export function desktopChannelOnboardingReadiness(
  keys: DesktopChannelKeyState | undefined,
): DesktopChannelOnboardingReadiness {
  if (keys === undefined) return 'settled'
  if (keys.channel || keys.official) return 'settled'
  return 'prompt'
}

/** Registration-side capabilities of the shipped route's first-run step. */
export interface DesktopChannelOnboardingInjected {
  /**
   * Read the configured state of every reference this step decides on.
   * @returns the per-reference state, or undefined when the seam cannot answer.
   */
  readonly readKeyState: () => Promise<DesktopChannelKeyState | undefined>
  /**
   * Store the shipped channel's credential literal.
   * @param value - the key the user entered.
   * @returns the Host refusal message, or undefined once stored.
   */
  readonly storeKey: (value: string) => Promise<string | undefined>
}

/** Renderer-composed props of the shipped route's first-run step. */
export type DesktopChannelOnboardingProps =
  PropsRuntime<'settings.onboarding'>
  & PropsLocale<'desktop.onboarding'>
  & InjectFace<DesktopChannelOnboardingInjected>

/**
 * Prompt for the shipped channel's key while no first-run route can serve a
 * request, then hand the step ledger to the next entry.
 * @param props - onboarding owner state plus this step's injected capabilities.
 * @returns the dialog, or null while the step decides or has nothing to ask.
 */
export function DesktopChannelOnboarding({
  complete, readKeyState, storeKey, t,
}: DesktopChannelOnboardingProps): ReactNode {
  const [readiness, setReadiness] = useState<DesktopChannelOnboardingReadiness>('deciding')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true
    void readKeyState().then(
      (keys) => { if (active) setReadiness(desktopChannelOnboardingReadiness(keys)) },
      () => { if (active) setReadiness('settled') },
    )
    return () => { active = false }
  }, [readKeyState])

  useEffect(() => {
    if (readiness === 'settled') complete()
  }, [readiness, complete])

  // The visible branch owns the dialog chrome: the application root stays inert
  // and Escape skips the step, so nothing behind the mask accepts input.
  useEffect(() => {
    if (readiness !== 'prompt') return
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [readiness])

  useEffect(() => {
    if (readiness !== 'prompt') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') complete()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [readiness, complete])

  const save = useCallback(() => {
    setSaving(true)
    setFailure(undefined)
    void storeKey(value).then(
      (refusal) => {
        if (refusal === undefined) {
          complete()
          return
        }
        setSaving(false)
        setFailure(refusal)
      },
      () => {
        setSaving(false)
        setFailure(t('saveFailed'))
      },
    )
  }, [complete, storeKey, t, value])

  // A step still deciding renders null, so nothing paints or blocks the app
  // while the credential seam answers.
  if (readiness !== 'prompt') return null

  return createPortal(
    <div className="dshDesktopChannelOnboardingMask">
      <div
        className="dshDesktopChannelOnboardingDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
      >
        <h2 id={TITLE_ID} className="dshDesktopChannelOnboardingTitle">{t('title')}</h2>
        <p className="dshDesktopChannelOnboardingDescription">{t('description')}</p>
        <label className="dshDesktopChannelOnboardingLabel" htmlFor={FIELD_ID}>{t('keyLabel')}</label>
        <input
          id={FIELD_ID}
          className="dshDesktopChannelOnboardingInput"
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('keyPlaceholder')}
          disabled={saving}
          onChange={(event) => { setValue(event.target.value) }}
        />
        <p className="dshDesktopChannelOnboardingHint">{t('hint')}</p>
        {failure !== undefined && (
          <p className="dshDesktopChannelOnboardingFailure" role="alert">
            {t('saveFailed')} <span className="dshDesktopChannelOnboardingDetail">{failure}</span>
          </p>
        )}
        <div className="dshDesktopChannelOnboardingActions">
          <button type="button" className="dshDesktopChannelOnboardingSkip" disabled={saving} onClick={complete}>
            {t('skip')}
          </button>
          <button
            type="button"
            className="dshDesktopChannelOnboardingSave"
            disabled={saving || value.length === 0}
            onClick={save}
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Register the shipped channel's first-run step and its copy.
 * @param ctx - client root context declaring `slots`, `locale`, and `remote.credentials`.
 */
export function applyDesktopChannelOnboarding(ctx: ClientContext): void {
  const readKeyState = async (): Promise<DesktopChannelKeyState | undefined> => {
    const response = await ctx.remote.credentials.describe([
      DESKTOP_CHANNEL_CREDENTIAL_REFERENCE,
      OFFICIAL_ROUTE_CREDENTIAL_REFERENCE,
    ])
    if (!response.ok) return undefined
    return {
      channel: response.value[DESKTOP_CHANNEL_CREDENTIAL_REFERENCE]?.configured === true,
      official: response.value[OFFICIAL_ROUTE_CREDENTIAL_REFERENCE]?.configured === true,
    }
  }
  const storeKey = async (value: string): Promise<string | undefined> => {
    const response = await ctx.remote.credentials.set(DESKTOP_CHANNEL_CREDENTIAL_REFERENCE, value)
    return response.ok ? undefined : response.error.message
  }

  ctx.effect(
    () => ctx.locale.register(DESKTOP_CHANNEL_ONBOARDING_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: first-run copy dictionaries',
  )
  ctx.effect(
    () => installDesktopChannelOnboardingStyles(),
    'dsh-plugin-desktop: first-run styles',
  )
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: DESKTOP_CHANNEL_ONBOARDING_STEP_ID,
    order: DESKTOP_CHANNEL_ONBOARDING_ORDER,
    locale: DESKTOP_CHANNEL_ONBOARDING_LOCALE_NAMESPACE,
    inject: () => ({ readKeyState, storeKey }),
  }, DesktopChannelOnboarding))
}

const CSS = `
.dshDesktopChannelOnboardingMask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, #000 45%, transparent);
  backdrop-filter: blur(2px);
}
.dshDesktopChannelOnboardingDialog {
  width: min(100%, 440px);
  padding: 24px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 24px 60px rgb(0 0 0 / 32%);
}
.dshDesktopChannelOnboardingTitle { margin: 0; font-size: 17px; font-weight: 600; }
.dshDesktopChannelOnboardingDescription {
  margin: 8px 0 18px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.dshDesktopChannelOnboardingLabel {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dshDesktopChannelOnboardingInput {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.dshDesktopChannelOnboardingHint {
  margin: 8px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.dshDesktopChannelOnboardingFailure {
  margin: 8px 0 0;
  color: var(--dsw-alias-label-error, #d4380d);
  font-size: 12px;
  line-height: 1.6;
}
.dshDesktopChannelOnboardingDetail { color: var(--dsw-alias-label-secondary); }
.dshDesktopChannelOnboardingActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.dshDesktopChannelOnboardingSkip,
.dshDesktopChannelOnboardingSave {
  padding: 6px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.dshDesktopChannelOnboardingSkip { background: transparent; color: var(--dsw-alias-label-primary); }
.dshDesktopChannelOnboardingSave { background: var(--dsw-alias-bg-accent, #4d6bfe); color: #fff; border-color: transparent; }
.dshDesktopChannelOnboardingSave:disabled,
.dshDesktopChannelOnboardingSkip:disabled { opacity: 0.5; cursor: default; }
`

/** Install one scoped stylesheet; tolerate headless Client boot. */
export function installDesktopChannelOnboardingStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
