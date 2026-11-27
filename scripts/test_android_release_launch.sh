#!/usr/bin/env bash
set -euo pipefail

package=com.mobile
snapshot=/data/local/tmp/ebp-release-smoke.xml

launch() {
  adb shell am start -W -a android.intent.action.MAIN \
    -c android.intent.category.LAUNCHER -n "$package/.MainActivity"
  for ((attempt = 0; attempt < 15; attempt++)); do
    adb shell rm -f "$snapshot"
    if adb shell uiautomator dump "$snapshot" >/dev/null 2>&1 &&
      adb exec-out cat "$snapshot" | grep -E 'resource-id="(com\.mobile:id/)?tab-identities"|text="Identities"' >/dev/null; then
      return
    fi
    sleep 2
  done
  adb logcat -d -b crash
  echo "EBP did not render its navigation after launch" >&2
  return 1
}

adb install -r "$1"
launch
original_pid=$(adb shell pidof "$package")
adb shell input keyevent KEYCODE_HOME
for ((attempt = 0; attempt < 15; attempt++)); do
  adb shell am kill "$package"
  if ! adb shell pidof "$package" >/dev/null; then break; fi
  sleep 1
done
if adb shell pidof "$package" >/dev/null; then
  echo "EBP's background process was still running" >&2
  exit 1
fi
launch
test "$(adb shell pidof "$package")" != "$original_pid"
