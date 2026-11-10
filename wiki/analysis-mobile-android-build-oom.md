---
title: "Analysis: Android Release Build OOM-Kills Cursor"
type: analysis
status: active
last_updated: 2026-10-30
source_count: 3
tags:
  - mobile
  - android
  - build
  - install
---

# Android Release Build OOM-Kills Cursor

## Summary

On this 16GB machine, building the [[component-mobile]] Android release from
the Cursor agent can kill Cursor itself. The phone stays on the previous
install because `adb install` never runs. It happened twice on 2026-10-30
(14:52 and 16:57).

## What the kernel did

`journalctl -k` shows a global OOM, then:

- 14:52:42 — `Out of memory: Killed process 134697 (cursor)` (`oom_score_adj=300`)
- 16:57:21 — `Out of memory: Killed process 152360 (cursor)` (`oom_score_adj=300`)

Cursor is the preferred victim. The Gradle and Kotlin processes that filled
RAM were left alive. The 14:52 killer was entered from `clang++` during the
native compile. The 16:57 killer was entered from an I/O thread while a second
Gradle daemon was growing.

## Why the build uses so much RAM

`mobile/android/gradle.properties` sets `org.gradle.jvmargs=-Xmx2048m`.
`assembleRelease` also starts a Kotlin compile daemon and parallel `clang++`
jobs (new architecture, `react-native-quick-crypto`, and the other native
modules).

A normal build uses `~/.gradle`. A build started inside the Cursor command
sandbox does not. The sandbox sets `__CURSOR_SANDBOX_ENV_RESTORE` and exports
`GRADLE_USER_HOME=/tmp/cursor-sandbox-cache/<id>/gradle` (plus `GOCACHE` and
`NPM_CONFIG_CACHE` under the same cache id). `~/.gradle` is still the real
directory and is writable; only the variable is redirected. The Gradle
daemon's cwd becomes `/tmp/cursor-sandbox-cache/<id>/gradle/daemon/8.14.3`.
That is a cold cache, so the build downloads and compiles again and keeps a
second daemon resident.

After the 14:52 crash, daemon pid 151378 (sandbox cache `93fe1c61…`, about
2.6GB) was still running at 16:57. The new sandboxed build added daemon pid
163419 and a Kotlin daemon (about 3.8GB + 0.9GB). Together with Cursor, Brave,
and the IDE's own Gradle daemons, RAM and the 2GB swap were full.

## What to do

1. Stop Java processes whose command line contains `/tmp/cursor-sandbox-cache/`
   and `gradle`. Do not stop the daemons under `~/.gradle`.
2. Require about 4GB `MemAvailable` before starting.
3. Run `./build_mobile_android.sh` with Node 22. When the Cursor sandbox is
   detected, the script pins `GRADLE_USER_HOME` to `~/.gradle` so Gradle reuses
   the existing daemon. It refuses to start below 4GB available, caps workers
   (`-Dorg.gradle.workers.max=2`), and installs with `--install`.
4. If Cursor dies mid-build, check whether
   `dist/mobile/ebp-mobile-release.apk` finished. Install that APK only when it
   is newer than `mobile/src`. On 2026-10-30 the 17:01 APK finished after the
   crash but was older than uncommitted chat/mail edits, and the phone's
   `com.mobile` `lastUpdateTime` was still 14:56.

Agent rule: `.cursor/rules/mobile-android-build.mdc`.

## Sources

- `build_mobile_android.sh`
- `mobile/android/gradle.properties`
- Kernel journal on computronium, 2026-10-30 14:52 and 16:57 (`journalctl -k`)
