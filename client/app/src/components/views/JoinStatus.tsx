import { useEffect, useRef } from "react"

import { AnimatePresence, motion } from "motion/react"

import useAudioStore from "@/stores/audio"
import useGameStore from "@/stores/game"

export const JoinStatus = ({ handleStart }: { handleStart: () => void }) => {
  const gameState = useGameStore.use.gameState()
  const setActiveModal = useGameStore.use.setActiveModal()
  const gameStateMessage = useGameStore.use.gameStateMessage?.()
  const diamondFXInstance = useGameStore.use.diamondFXInstance?.()
  const statusPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (gameState !== "not_ready" || !diamondFXInstance || !statusPanelRef.current) return

    // Defer start past the initial render storm — kicking off DiamondFX while
    // the rest of the screen is still mounting causes a visible jank spike.
    const panelId = statusPanelRef.current.id
    let innerRaf = 0
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        diamondFXInstance.start(panelId)
      })
    })

    return () => {
      cancelAnimationFrame(outerRaf)
      cancelAnimationFrame(innerRaf)
    }
  }, [gameState, diamondFXInstance])

  useEffect(() => {
    if (gameState !== "ready" || !diamondFXInstance) return

    diamondFXInstance?.clear(true)

    // Fade out theme music over 1 second
    useAudioStore.getState().fadeOut("theme", { duration: 1000 })
  }, [gameState, diamondFXInstance])

  return (
    <div className="absolute inset-0 z-90 h-full w-full flex items-center justify-center bg-gray-800/20 backdrop-blur-lg bg-dotted-lg bg-dotted-white/10 bg-center pointer-events-none select-none">
      <motion.div
        animate={{ opacity: 1 }}
        initial={{ opacity: 0 }}
        transition={{ duration: 1, delay: 1 }}
        onAnimationComplete={() => {
          if (gameState !== "not_ready") return
          handleStart()
          setActiveModal(undefined)
        }}
      >
        <div id="status-panel" className="screen p-4" ref={statusPanelRef}>
          <AnimatePresence mode="wait">
            <motion.span
              key={gameStateMessage}
              initial={{ opacity: 0, y: -10 }}
              animate={{
                opacity: 1,
                transition: { duration: 0.3, delay: 0.2 },
              }}
              exit={{ opacity: 0, y: 10, transition: { duration: 0.3 } }}
              className="uppercase relative animate-pulse text-center font-medium tracking-widest"
            >
              {gameStateMessage}
            </motion.span>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

export default JoinStatus
