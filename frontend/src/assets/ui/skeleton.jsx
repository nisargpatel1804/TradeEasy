import { cn } from "../../utils/cn.js"

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-xl bg-gradient-to-r from-muted/80 via-muted/60 to-muted/80 text-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
