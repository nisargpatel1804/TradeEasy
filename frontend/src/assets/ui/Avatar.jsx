import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"
import { cva } from "class-variance-authority"

import { cn } from "../../utils/cn.js"

const avatarVariants = cva(
  "relative flex shrink-0 overflow-hidden rounded-full border border-border/60 bg-gradient-to-br from-muted/70 via-background to-muted/50 text-muted-foreground shadow-inner",
  {
    variants: {
      size: {
        xs: "h-8 w-8 text-xs",
        sm: "h-9 w-9 text-sm",
        md: "h-10 w-10",
        lg: "h-12 w-12 text-lg",
        xl: "h-16 w-16 text-xl",
      },
      isInteractive: {
        true: "ring-2 ring-primary/30",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

const Avatar = React.forwardRef(({ className, size, isInteractive, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(avatarVariants({ size, isInteractive }), className)}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full object-cover", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef(({ className, children, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted/60 text-sm font-semibold uppercase tracking-wide",
      className
    )}
    {...props}
  >
    {children}
  </AvatarPrimitive.Fallback>
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }

