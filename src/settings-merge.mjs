export const SHARED_KEYS = ['enabledPlugins', 'extraKnownMarketplaces', 'model', 'effortLevel'];

export function extractShared(localSettings) {
  const out = {};
  for (const key of SHARED_KEYS) {
    if (localSettings?.[key] !== undefined) out[key] = localSettings[key];
  }
  return out;
}

/**
 * Overlays the shared keys onto local settings. Every other field - hooks,
 * permissions, env - belongs to this machine and is left untouched.
 */
export function mergeShared(localSettings, sharedSettings) {
  const merged = { ...localSettings };
  for (const key of SHARED_KEYS) {
    if (sharedSettings?.[key] !== undefined) merged[key] = sharedSettings[key];
  }
  return merged;
}
