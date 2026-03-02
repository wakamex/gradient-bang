import { Workbox } from "workbox-window"

/**
 * Service worker lifecycle management.
 *
 * Uses workbox-window directly (not vite-plugin-pwa's registerSW wrapper)
 * for full control over activation timing and no hidden reload behavior.
 *
 * Exports:
 * - `swReady`   — promise the app awaits before rendering
 * - `swStatus`  — reactive store for FullScreenLoader to show update progress
 *
 * Three scenarios:
 * 1. First visit (no controller): register SW, resolve immediately.
 *    Preload screen fetches assets; SW's runtime caching stores them.
 * 2. Return visit, same version: SW controlling, no update → resolve quickly.
 * 3. Return visit, new version: detect new SW, wait for install (near-instant,
 *    only CSS/fonts precached), activate it, then resolve. checkAssetsAreCached()
 *    detects version mismatch → preload screen shows.
 */

// ---------------------------------------------------------------------------
// Reactive status store (for useSyncExternalStore in FullScreenLoader)
// ---------------------------------------------------------------------------

type SwStatus = "checking" | "updating" | "ready"
let _status: SwStatus = "checking"
let _listeners: Array<() => void> = []

export const swStatus = {
  getSnapshot: () => _status,
  subscribe: (cb: () => void) => {
    _listeners.push(cb)
    return () => {
      _listeners = _listeners.filter((l) => l !== cb)
    }
  },
}

function setStatus(s: SwStatus) {
  _status = s
  _listeners.forEach((l) => l())
}

// ---------------------------------------------------------------------------
// swReady promise
// ---------------------------------------------------------------------------

let resolveReady: () => void

/** Resolves once the SW state is settled and we know whether preload is needed. */
export const swReady = new Promise<void>((r) => {
  resolveReady = r
})

// No SW support → resolve immediately
if (!("serviceWorker" in navigator)) {
  setStatus("ready")
  resolveReady!()
} else {
  initServiceWorker()
}

// ---------------------------------------------------------------------------
// SW initialization
// ---------------------------------------------------------------------------

async function initServiceWorker() {
  // Safety timeout — never block the app longer than 5 seconds
  const safetyTimer = setTimeout(() => {
    console.log("[SW] Update check timed out, proceeding")
    settled()
  }, 5000)

  function settled() {
    clearTimeout(safetyTimer)
    setStatus("ready")
    resolveReady()
  }

  try {
    const wb = new Workbox(import.meta.env.BASE_URL + "sw.js")

    // ----- First visit: no existing controller -----
    if (!navigator.serviceWorker.controller) {
      console.log("[SW] First visit, registering SW")
      wb.register()
      settled()
      return
    }

    // ----- Return visit: controller exists, check for updates -----
    console.log("[SW] Return visit, checking for updates...")
    const registration = await wb.register()

    if (!registration) {
      settled()
      return
    }

    // Check if there's already a waiting or installing SW
    if (registration.waiting) {
      console.log("[SW] Found waiting SW, activating...")
      setStatus("updating")
      await activateWaitingSW(registration.waiting)
      settled()
      return
    }

    if (registration.installing) {
      console.log("[SW] Found installing SW, waiting for install...")
      setStatus("updating")
      await waitForInstallThenActivate(registration.installing)
      settled()
      return
    }

    // No installing or waiting SW. The browser's update check runs async
    // after register(), but for unchanged SWs the byte comparison is
    // near-instant and usually completes before register() resolves.
    // Use a short grace period to catch the rare case where it hasn't.
    const updateDetected = await Promise.race([
      new Promise<true>((resolve) => {
        const onWaiting = () => {
          wb.removeEventListener("waiting", onWaiting)
          resolve(true)
        }
        wb.addEventListener("waiting", onWaiting)
      }),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), 300)
      }),
    ])

    if (updateDetected) {
      console.log("[SW] Update detected, activating new SW...")
      setStatus("updating")
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg?.waiting) {
        await activateWaitingSW(reg.waiting)
      }
    } else {
      console.log("[SW] No update detected, proceeding")
    }

    settled()
  } catch (error) {
    console.error("[SW] Error during initialization:", error)
    settled()
  }

  // Check for updates when returning to a stale tab
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      const reg = await navigator.serviceWorker.getRegistration()
      reg?.update()
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tell a waiting SW to skip waiting, then wait for it to take control. */
function activateWaitingSW(waitingSW: ServiceWorker): Promise<void> {
  return new Promise<void>((resolve) => {
    const onControllerChange = () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      console.log("[SW] New SW is now controlling")
      resolve()
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)

    // Tell the waiting SW to skip waiting (workbox-generated SW listens for this)
    waitingSW.postMessage({ type: "SKIP_WAITING" })
  })
}

/** Wait for an installing SW to finish, then activate it. */
function waitForInstallThenActivate(installingSW: ServiceWorker): Promise<void> {
  return new Promise<void>((resolve) => {
    const onStateChange = () => {
      if (installingSW.state === "installed") {
        installingSW.removeEventListener("statechange", onStateChange)
        activateWaitingSW(installingSW).then(resolve)
      } else if (installingSW.state === "redundant" || installingSW.state === "activated") {
        installingSW.removeEventListener("statechange", onStateChange)
        resolve()
      }
    }
    installingSW.addEventListener("statechange", onStateChange)
  })
}
