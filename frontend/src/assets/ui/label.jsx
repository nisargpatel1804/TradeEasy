import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva } from "class-variance-authority"

import { cn } from "../../utils/cn.js"

const labelVariants = cva(
  "text-sm font-semibold leading-none text-muted-foreground/90 peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
  {
    variants: {
      tone: {
        default: "",
        subtle: "text-muted-foreground",
        accent: "text-primary",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  }
)

const Label = React.forwardRef(({ className, tone, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants({ tone }), className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
