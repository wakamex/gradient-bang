import { useState } from "react"

import { Button } from "@/components/primitives/Button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/primitives/Card"

export const Error = ({
  children,
  title,
  noButton = false,
  buttonLabel = "Try again",
  onRetry,
}: {
  children: React.ReactNode
  title?: string
  noButton?: boolean
  buttonLabel?: string
  onRetry?: () => void
}) => {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <Card
      variant="stripes"
      className="h-screen stripe-frame-destructive bg-destructive/10"
      size="lg"
    >
      <CardHeader>
        <CardTitle className="text-5xl animate-pulse">{title || "Connection Error"}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="normal-case">{children}</p>
      </CardContent>
      {!noButton && (
        <CardContent className="mt-auto">
          <Button size="xl" onClick={onRetry ?? (() => setDismissed(true))}>
            {buttonLabel}
          </Button>
        </CardContent>
      )}
    </Card>
  )
}

export default Error
