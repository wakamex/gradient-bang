const CACHE_VERSION_KEY = "gb_cached_version"

export const checkAssetsAreCached = (): boolean => {
  const hasController = !!navigator.serviceWorker?.controller
  const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY)
  const currentVersion = import.meta.env.VITE_APP_VERSION

  console.log("[GAME CACHE] SW state:", {
    hasController,
    cachedVersion,
    currentVersion,
    match: cachedVersion === currentVersion,
  })

  // Both conditions required:
  // 1. A SW is controlling (assets are being served from cache)
  // 2. The cached version matches the current build (correct assets)
  return hasController && cachedVersion === currentVersion
}

export const markAssetsCached = (): void => {
  localStorage.setItem(CACHE_VERSION_KEY, import.meta.env.VITE_APP_VERSION)
}
