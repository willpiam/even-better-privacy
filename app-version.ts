/**
 * Application/component versions.
 * Keep these in sync across all entrypoints (server, GUI, CLI, email plugin).
 */
export const APP_VERSION = "0.1.0";
export const COMPONENT_VERSIONS = {
  server: APP_VERSION,
  cli: APP_VERSION,
  gui: APP_VERSION,
  guiLocalBackend: APP_VERSION,
  emailPlugin: APP_VERSION,
} as const;
