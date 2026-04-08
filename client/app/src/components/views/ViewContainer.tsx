import { lazy, Suspense, useCallback, useState } from "react"

import { AnimatePresence, motion } from "motion/react"
import { useMediaQuery } from "@uidotdev/usehooks"

import { Mobile } from "@/components/mobile"
import { useGameContext } from "@/hooks/useGameContext"
import useGameStore from "@/stores/game"
import { checkAssetsAreCached } from "@/utils/cache"
import { Error } from "@/views/Error"
import { JoinStatus } from "@/views/JoinStatus"
import { Preload } from "@/views/Preload"
import { Title } from "@/views/Title"

const Game = lazy(() => import("@/views/Game"))

export const ViewContainer = ({ error }: { error?: string | null }) => {
  const gameState = useGameStore.use.gameState()
  const { initialize } = useGameContext()
  const [viewState, setViewState] = useState<"title" | "preload" | "game">(() => {
    if (checkAssetsAreCached()) {
      console.log(
        "%c[GAME] Assets already cached, skipping preload screen",
        "background: #90EE90; color: #006400; font-weight: bold"
      )
      return "title"
    }
    return "preload"
  })

  const isSmallDevice = useMediaQuery("only screen and (max-width : 768px)")

  const handleViewStateChange = useCallback((state: "title" | "preload" | "game") => {
    // If transitioning to preload, check if assets are already cached
    if (state === "preload") {
      const cached = checkAssetsAreCached()

      if (cached) {
        console.log("[GAME] Assets already cached, skipping preload screen")
        setViewState("game")
        return
      }

      console.log("[GAME] Cache incomplete, showing preload screen")
    }

    setViewState(state)
  }, [])

  if (error || gameState === "error") {
    return <Error>{error}</Error>
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={viewState}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        className="relative h-screen w-screen overflow-hidden"
      >
        {viewState === "preload" && <Preload onComplete={() => handleViewStateChange("title")} />}
        {viewState === "title" && <Title onViewNext={() => handleViewStateChange("game")} />}
        {viewState === "game" && (
          <>
            <AnimatePresence>
              {gameState !== "ready" && (
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <JoinStatus
                    handleStart={() => {
                      if (gameState !== "not_ready") return
                      initialize()
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <Suspense fallback={null}>
              {isSmallDevice ?
                <Mobile />
              : <Game />}
            </Suspense>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

export default ViewContainer
