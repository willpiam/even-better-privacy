#!/usr/bin/env bash

# Load nvm and activate a modern Node version (RN 0.84 requires >= 22.11.0)
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || nvm use 20 >/dev/null 2>&1 || nvm use 18 >/dev/null 2>&1

set -euo pipefail

# RN 0.84 Android toolchain requires JDK 17.
if [ -d "$HOME/.local/jdks/jdk-17.0.18+8" ]; then
  export JAVA_HOME="$HOME/.local/jdks/jdk-17.0.18+8"
else
  export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
fi

cd "$(dirname "$0")"
exec npx react-native run-android "$@"
