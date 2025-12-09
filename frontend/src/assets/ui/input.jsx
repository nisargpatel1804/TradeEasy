import * as React from "react"

import { cn } from "../../utils/cn.js"

const Input = React.forwardRef(({ className, type = "text", subtle = false, ...props }, ref) => {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-xl border border-border/60 bg-white/90 px-4 py-2 text-sm font-medium text-foreground/90 shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 file:mr-3 file:rounded-md file:border-0 file:bg-muted/70 file:px-3 file:py-1 file:text-xs file:font-semibold",
        subtle && "bg-muted/40",
        className
      )}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
