import { useSyncExternalStore } from "react"

import { FullScreenLoader } from "@/components/FullScreenLoader"
import { swStatus } from "@/sw-update"

export const SuspenseLoader = () => {
  const status = useSyncExternalStore(swStatus.subscribe, swStatus.getSnapshot)
  const message =
    status === "updating" ? "Updating to new version..."
    : status === "checking" ? "Checking for updates..."
    : "Initializing"
  return <FullScreenLoader message={message} />
}
