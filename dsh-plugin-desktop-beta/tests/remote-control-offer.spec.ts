import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { RemoteControlOffer } from '../src/remote-control-offer.ts'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

interface OfferOptions {
  path: string
  readEnabled(): Promise<boolean>
  enable(): Promise<void>
  confirm(copy: unknown): Promise<boolean>
  reportError(cause: unknown): void
}

type Offer = RemoteControlOffer

/**
 * Load the offer under an explicit gate value. The feature flag is read once at
 * module load, so each case gets a fresh module instance.
 */
async function offerClass(open: boolean): Promise<new (options: OfferOptions) => Offer> {
  vi.resetModules()
  vi.stubEnv('DSH_FEATURE_REMOTE_CONTROL', open ? '1' : '')
  const module = await import('../src/remote-control-offer.ts')
  return module.RemoteControlOffer as new (options: OfferOptions) => Offer
}

async function fixture(open: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'remote-control-offer-'))
  directories.push(directory)
  const RemoteControlOffer = await offerClass(open)
  const options: OfferOptions = {
    path: join(directory, 'notice'),
    readEnabled: vi.fn(async () => false),
    enable: vi.fn(async () => {}),
    confirm: vi.fn(async () => false),
    reportError: vi.fn(),
  }
  return { options, offer: new RemoteControlOffer(options) }
}

it('remembers the first click across launches even when activation is cancelled', async () => {
  const { options, offer } = await fixture(true)
  expect(await offer.read()).toEqual({ enabled: false, seen: false })
  await offer.open('zh')
  expect(options.enable).not.toHaveBeenCalled()
  const RemoteControlOffer = await offerClass(true)
  expect(await new RemoteControlOffer(options).read()).toEqual({ enabled: false, seen: true })
})

it('only enables after confirmation and does not offer an already enabled plugin', async () => {
  const { options, offer } = await fixture(true)
  options.confirm = vi.fn(async () => true)
  await offer.open('en')
  expect(options.enable).toHaveBeenCalledTimes(1)
  options.readEnabled = vi.fn(async () => true)
  await offer.open('en')
  expect(options.confirm).toHaveBeenCalledTimes(1)
  expect((await offer.read()).enabled).toBe(true)
})

it('deduplicates clicks while confirmation is open', async () => {
  const { options, offer } = await fixture(true)
  let confirm!: (value: boolean) => void
  options.confirm = vi.fn(() => new Promise<boolean>(resolve => { confirm = resolve }))
  const first = offer.open('zh')
  const second = offer.open('zh')
  expect(second).toBe(first)
  await vi.waitFor(() => expect(options.confirm).toHaveBeenCalledTimes(1))
  confirm(true)
  await first
  expect(options.enable).toHaveBeenCalledTimes(1)
})

it('keeps the notice seen after failure and permits retry', async () => {
  const { options, offer } = await fixture(true)
  options.confirm = vi.fn(async () => true)
  options.enable = vi.fn(async () => {}).mockRejectedValueOnce(new Error('save failed'))
  await expect(offer.open('zh')).rejects.toThrow('save failed')
  expect((await offer.read()).seen).toBe(true)
  await offer.open('zh')
  expect(options.enable).toHaveBeenCalledTimes(2)
})

it('never asks, enables, or records anything while the gate is closed', async () => {
  const { options, offer } = await fixture(false)
  expect(await offer.read()).toEqual({ enabled: false, seen: false })
  await offer.open('zh')
  expect(options.confirm).not.toHaveBeenCalled()
  expect(options.enable).not.toHaveBeenCalled()
  expect((await offer.read()).seen).toBe(false)
})
