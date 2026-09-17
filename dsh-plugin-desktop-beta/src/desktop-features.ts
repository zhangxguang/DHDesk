/**
 * Desktop-level feature availability.
 *
 * These are compile-time product decisions, not user preferences. A closed
 * feature keeps its full implementation and tests but has no entry point, no
 * bundled plugin, and no reachable persisted state; opening its flag restores
 * every one of those paths.
 */

/**
 * Remote control (`手机连接` / Agents-Anywhere) availability.
 *
 * Closed on purpose: the optional `@agents-anywhere/dsh-bridge-next` bundle
 * mirrors session content, workspace paths, and command history to an
 * Agents-Anywhere server, and that transfer is not covered by the shipped
 * privacy policy yet. Re-enable only together with a self-hosted server path
 * (or an updated disclosure), by changing this one literal.
 *
 * Closing it must keep all of these true in the same generation:
 * - no `agents-anywhere-bridge-next` row in the composed Profile;
 * - no `手机连接` step in Desktop Setup and no Agents-Anywhere group in Desktop
 *   settings;
 * - no native `远程控制` title-bar action and no offer dialog;
 * - a stored `aaEnabled: true` is never honored and is written back as `false`.
 *
 * `DSH_FEATURE_REMOTE_CONTROL=1` opens it for one process, so both branches of
 * the gate stay covered by tests while the shipped literal stays closed.
 */
export const DESKTOP_REMOTE_CONTROL_ENABLED: boolean = process.env.DSH_FEATURE_REMOTE_CONTROL === '1'
