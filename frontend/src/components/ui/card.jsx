import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "../../lib/cn.js"

const cardVariants = cva(
  "group relative rounded-2xl border border-border/70 bg-gradient-to-b from-background/95 via-card to-card/95 text-card-foreground shadow-[0_18px_35px_rgba(15,23,42,0.08)] transition-all duration-300",
  {
    variants: {
      interactive: {
        true: "hover:-translate-y-0.5 hover:border-border hover:shadow-[0_25px_45px_rgba(15,23,42,0.12)]",
      },
      tone: {
        neutral: "",
        accent: "border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background",
        muted: "border-muted bg-muted/40",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

const Card = React.forwardRef(({ className, interactive = false, tone, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(cardVariants({ interactive, tone }), className)}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-2 px-6 pt-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-xl font-semibold leading-tight tracking-tight text-foreground", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-6 pb-6 pt-4", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-3 px-6 pb-6 pt-0 sm:flex-row sm:items-center sm:justify-end", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }

