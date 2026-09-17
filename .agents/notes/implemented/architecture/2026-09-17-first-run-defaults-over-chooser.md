# Agent Note: First run commits the shipped defaults instead of opening Desktop Setup

Status: implemented

## Problem

A profile with no Setup marker used to meet the native Desktop Setup chooser before the Host booted. That chooser asked for shell mode, window material, browser and network exposure, notifications, and the Market provider — every one of them a Desktop settings control behind a running app.

Opening with a chooser delays the surface the user installed, and a first run that never finishes the chooser never reaches the app at all.

## Decision

A first run commits the shipped defaults and starts. `desktopFirstRunAction` owns the decision as a pure predicate: Safe Mode, an already-settled marker, and a profile that already holds usage evidence take no action; what remains is whether this build asks or commits, which `DESKTOP_SETUP_CHOOSER_ENABLED` in `desktop-features.ts` answers. It ships closed.

The commit (`setup-wizard-defaults.ts`) performs the writes the chooser's own Skip action performed — preferences, re-composition, then the Setup marker — so a profile that was never asked and one whose owner declined it persist the same state. The settings document is not written: every value the chooser would have written is already its default, and a document that already carries choices is inherited rather than overwritten.

The marker records `completed`, not `skipped`. The launcher did finish Setup, with the shipped defaults, and channel admission reads that marker as profile usage evidence where "this profile left first run" is the fact that matters.

## The chooser is retained

Deleting the chooser was considered and rejected. `DESKTOP_SETUP_CHOOSER_ENABLED` gates a complete, tested path: the window, its native-UI bundle, the `dsh-setup-wizard:` scheme, its copy, and the quit/skip/complete branches. Opening the literal — or `DSH_FEATURE_SETUP_CHOOSER=1` for one process — restores it, and the wizard window keeps every protection the local-window security policy requires of it.

A maintainer who finds the chooser unreachable should read this note before treating it as dead code.

## Unchanged behavior

- Safe Mode reaches neither branch and still boots on shipped defaults.
- A profile that already holds usage evidence is never asked.
- An explicit recovery launch still enters Recovery Assistant first.

## Verification

`tests/setup-wizard-defaults.spec.ts` covers the decision's truth table, the shipped gate literal (by re-importing the module with the override cleared), the commit's write order, the inherited-document case, and the marker. `tests/package.spec.ts` pins that Safe Mode reaches the decision at all, which is the part only the launcher can show.
