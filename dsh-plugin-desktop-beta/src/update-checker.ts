/** Headless version checks against the public DHDesk release service. */

import {
  assertDesktopInstallationId,
  DESKTOP_INSTALLATION_ID_HEADER,
  type DesktopInstallationId,
} from './desktop-installation-id.ts'

/** DHDesk's public GitHub Releases API. The release assets are the only update source. */
export const DESKTOP_VERSION_ENDPOINT = 'https://api.github.com/repos/zhangxguang/DHDesk/releases'

/** Header carrying the installed Desktop version to the fixed version endpoint. */
export const DESKTOP_CURRENT_VERSION_HEADER = 'X-DHDesk-Version'

/** Header selecting an isolated Desktop release stream. */
export const DESKTOP_RELEASE_CHANNEL_HEADER = 'X-DHDesk-Channel'

/** Release streams supported by the Desktop service. */
export type DesktopReleaseChannel = 'stable' | 'beta'

/** Maximum response body bytes accepted from the version service. */
export const MAX_VERSION_RESPONSE_BYTES = 512 * 1024

/** Strictly parsed SemVer components. Numeric components remain strings to avoid overflow. */
export interface ParsedSemVer {
  /** Canonical version without the optional leading `v`. */
  readonly version: string
  /** Major numeric identifier. */
  readonly major: string
  /** Minor numeric identifier. */
  readonly minor: string
  /** Patch numeric identifier. */
  readonly patch: string
  /** Ordered prerelease identifiers, or an empty list for a stable version. */
  readonly prerelease: readonly string[]
  /** Build identifiers, ignored for version precedence. */
  readonly build: readonly string[]
}

/** Fetch-compatible request function used by the headless checker. */
export type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** Inputs for one channel-scoped version check. */
export interface UpdateCheckOptions {
  /** Injectable platform for headless verification; native callers use the current process. */
  readonly platform?: NodeJS.Platform
  /** Installed application version, expressed as canonical SemVer. */
  readonly currentVersion: string
  /** Release stream that must be returned by the service. */
  readonly channel: DesktopReleaseChannel
  /** Channel of the installed application when explicitly switching streams. */
  readonly currentChannel?: DesktopReleaseChannel
  /** Treat a different older version as selectable for an explicit channel switch. */
  readonly allowDowngrade?: boolean
  /** Caller-owned cancellation signal; the checker does not create its own timeout. */
  readonly signal?: AbortSignal
  /** Optional fetch implementation for a host adapter or test. */
  readonly request?: UpdateRequest
  /** Installation UUID attached only to the fixed version-check endpoint. */
  readonly installationId?: DesktopInstallationId
}

/** Successful comparison returned by the stable version service. */
export type UpdateCheckResult = {
  /** Whether the service reports a version newer than the installed application. */
  readonly status: 'up-to-date' | 'update-available'
  /** Canonical installed version, including any prerelease identifiers. */
  readonly currentVersion: string
  /** Canonical latest stable version returned by the service. */
  readonly latestVersion: string
  /** Platform-specific GitHub Release asset selected for the running channel. */
  readonly artifactUrl?: string
  /** Asset filename, retained for diagnostics and destination defaults. */
  readonly artifactName?: string
  /** GitHub's SHA-256 digest when the release API provides one. */
  readonly artifactDigest?: string
}

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/**
 * Parse strict SemVer with an optional lowercase `v` prefix.
 * @param input - complete version or release tag.
 * @returns parsed identifiers, or null when the input is not valid SemVer.
 */
export function parseSemVer(input: string): ParsedSemVer | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null

  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => isNumeric(identifier) && hasLeadingZero(identifier))) return null

  return {
    version,
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    prerelease,
    build: match[5]?.split('.') ?? [],
  }
}

/**
 * Compare two strict SemVer strings without numeric overflow.
 * @param left - first strict SemVer value.
 * @param right - second strict SemVer value.
 * @returns negative, zero, or positive precedence, or null when either value is invalid.
 */
export function compareSemVerVersions(left: string, right: string): number | null {
  const leftVersion = parseSemVer(left)
  const rightVersion = parseSemVer(right)
  if (leftVersion === null || rightVersion === null) return null
  return compareParsedSemVer(leftVersion, rightVersion)
}

/**
 * Check the fixed DHDesk version endpoint for a release in one channel.
 * @param options - installed version, caller-owned signal, and optional request adapter.
 * @returns a successful comparison, or null when any request or validation step fails.
 */
export async function checkForDesktopUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
  const current = parseCanonicalChannelVersion(
    options.currentVersion,
    options.currentChannel ?? options.channel,
  )
  if (current === null) return null

  let headers: HeadersInit
  try {
    headers = desktopVersionRequestHeaders(options.installationId, current.version, options.channel)
  } catch {
    return null
  }

  const init: RequestInit = {
    method: 'GET',
    headers,
    cache: 'no-store',
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const request = options.request ?? defaultRequest

  let response: Response
  try {
    response = await request(DESKTOP_VERSION_ENDPOINT, init)
  } catch {
    return null
  }
  if (response.status !== 200) return null

  let body: string
  try {
    body = await readLimitedBody(response)
  } catch {
    return null
  }

  const release = parseReleaseResponse(body, options.channel, options.platform ?? process.platform)
  if (release === null) return null
  const comparison = compareParsedSemVer(release.version, current)
  return {
    status: comparison > 0 || (options.allowDowngrade === true && comparison !== 0)
      ? 'update-available'
      : 'up-to-date',
    currentVersion: current.version,
    latestVersion: release.version.version,
    artifactUrl: release.artifact.url,
    artifactName: release.artifact.name,
    artifactDigest: release.artifact.digest,
  }
}

/** Stable-channel convenience entry point. */
export function checkForStableUpdate(
  options: Omit<UpdateCheckOptions, 'channel'>,
): Promise<UpdateCheckResult | null> {
  return checkForDesktopUpdate({ ...options, channel: 'stable' })
}

/** Build the complete header set for the fixed version-check request only. */
export function desktopVersionRequestHeaders(
  installationId?: string,
  currentVersion?: string,
  channel?: DesktopReleaseChannel,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (channel !== undefined) headers[DESKTOP_RELEASE_CHANNEL_HEADER] = channel
  if (currentVersion !== undefined) {
    const parsed = channel === undefined
      ? parseCanonicalChannelVersion(currentVersion, 'stable')
      : parseCanonicalSupportedVersion(currentVersion)
    if (parsed === null) {
      throw new Error(channel === undefined
        ? 'Desktop current version must be canonical stable SemVer.'
        : 'Desktop current version must be canonical SemVer.')
    }
    headers[DESKTOP_CURRENT_VERSION_HEADER] = parsed.version
  }
  if (installationId !== undefined) {
    headers[DESKTOP_INSTALLATION_ID_HEADER] = assertDesktopInstallationId(installationId)
  }
  return headers
}

async function defaultRequest(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init)
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null
    && /^[0-9]+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(MAX_VERSION_RESPONSE_BYTES)) {
    throw new Error('version response is too large')
  }

  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > MAX_VERSION_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('version response is too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

interface ReleaseArtifact {
  readonly name: string
  readonly url: string
  readonly digest: string
}

interface ParsedRelease {
  readonly version: ParsedSemVer
  readonly artifact: ReleaseArtifact
}

function parseReleaseResponse(
  body: string,
  expectedChannel: DesktopReleaseChannel,
  platform: NodeJS.Platform,
): ParsedRelease | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!Array.isArray(value)) return null
  const candidates = value
    .filter(isRecord)
    .filter(release => release.draft !== true)
    .map(release => {
      const tag = typeof release.tag_name === 'string' ? release.tag_name : undefined
      const normalizedTag = tag === undefined
        ? null
        : expectedChannel === 'beta' && tag.startsWith('beta-v')
          ? tag.slice('beta-v'.length)
          : tag.startsWith('v') ? tag.slice(1) : tag
      const version = normalizedTag === null ? null : parseCanonicalChannelVersion(normalizedTag, expectedChannel)
      const prerelease = version?.prerelease.length !== 0
      if (version === null || (expectedChannel === 'beta') !== prerelease
        || (expectedChannel === 'beta' ? release.prerelease !== true : release.prerelease === true)) return null
      const assets = Array.isArray(release.assets) ? release.assets.filter(isRecord) : []
      const artifact = assets
        .map(asset => {
          const name = typeof asset.name === 'string' ? asset.name : undefined
          const url = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : undefined
          if (name === undefined || url === undefined || !isPlatformArtifact(name, platform, expectedChannel, version.version)
            || !isDHDeskReleaseAssetUrl(url, version.version, name, expectedChannel)) return null
          const digest = typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(asset.digest)
            ? asset.digest.slice('sha256:'.length)
            : undefined
          if (digest === undefined) return null
          return { name, url, digest }
        })
        .find(entry => entry !== null) as ReleaseArtifact | undefined
      return artifact === undefined ? null : { version, artifact }
    })
    .filter((entry): entry is ParsedRelease & { readonly artifact: ReleaseArtifact } => entry !== null)
    .sort((left, right) => compareParsedSemVer(right.version, left.version))
  return candidates[0] ?? null
}

function isPlatformArtifact(name: string, platform: NodeJS.Platform, channel: DesktopReleaseChannel, version: string): boolean {
  const lower = name.toLowerCase()
  const product = channel === 'beta' ? 'DHDesk-Beta' : 'DHDesk'
  if (!name.startsWith(`${product}-${version}-`)) return false
  return platform === 'darwin'
    ? lower.endsWith('-universal.dmg')
    : platform === 'win32'
      ? lower.endsWith('-x64-setup.exe')
      : false
}

/** Allow only an immutable-version asset from DHDesk's own GitHub repository. */
export function isDHDeskReleaseAssetUrl(
  value: string,
  version: string,
  name?: string,
  channel: DesktopReleaseChannel = 'stable',
): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port !== ''
      || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false
    const segments = url.pathname.split('/').map(decodeURIComponent)
    return segments.length === 7 && segments[1] === 'zhangxguang' && segments[2] === 'DHDesk'
      && segments[3] === 'releases' && segments[4] === 'download'
      && (segments[5] === `v${version}` || segments[5] === version
        || (channel === 'beta' && segments[5] === `beta-v${version}`))
      && (name === undefined || segments[6] === name)
  } catch { return false }
}

function parseCanonicalChannelVersion(
  input: string,
  channel: DesktopReleaseChannel,
): ParsedSemVer | null {
  const parsed = parseCanonicalVersion(input)
  if (parsed === null) return null
  if (channel === 'stable') return parsed.prerelease.length === 0 ? parsed : null
  return parsed.prerelease.length === 2
    && parsed.prerelease[0] === 'beta'
    && isNumeric(parsed.prerelease[1]!)
    ? parsed
    : null
}

function parseCanonicalSupportedVersion(input: string): ParsedSemVer | null {
  return parseCanonicalChannelVersion(input, 'stable')
    ?? parseCanonicalChannelVersion(input, 'beta')
}

function parseCanonicalVersion(input: string): ParsedSemVer | null {
  const parsed = parseSemVer(input)
  return parsed !== null && parsed.version === input ? parsed : null
}

function compareParsedSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumeric(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = isNumeric(leftIdentifier)
    const rightNumeric = isNumeric(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumeric(leftIdentifier, rightIdentifier)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isNumeric(identifier: string): boolean {
  return /^[0-9]+$/u.test(identifier)
}

function hasLeadingZero(identifier: string): boolean {
  return identifier.length > 1 && identifier.startsWith('0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
