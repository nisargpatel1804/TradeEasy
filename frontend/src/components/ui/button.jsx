import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { Loader2 } from "lucide-react"
import { cva } from "class-variance-authority"

import { cn } from "../../lib/cn.js"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent text-sm font-semibold tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 active:translate-y-[1px]",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 hover:from-blue-500 hover:to-indigo-500",
        primary:
          "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90",
        secondary:
          "bg-secondary/90 text-secondary-foreground border border-secondary/30 hover:bg-secondary",
        outline:
          "border border-border/70 bg-transparent text-foreground hover:bg-muted/60",
        subtle:
          "bg-muted/70 text-foreground hover:bg-muted",
        soft:
          "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15",
        ghost:
          "bg-transparent text-foreground hover:bg-muted/70",
        link:
          "text-primary underline-offset-4 hover:underline focus-visible:ring-0",
        destructive:
          "bg-red-600 text-white shadow-lg shadow-red-500/20 hover:bg-red-500",
        elevated:
          "bg-card text-card-foreground border border-border/80 shadow-[0_10px_20px_rgba(15,23,42,0.15)] hover:shadow-[0_15px_25px_rgba(15,23,42,0.2)]",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10 p-0",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      asChild = false,
      isLoading = false,
      loadingText,
      spinner,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button"
    const content = isLoading && loadingText ? loadingText : children
    const sharedClassName = cn(
      buttonVariants({ variant, size, fullWidth }),
      isLoading && "pointer-events-none opacity-90",
      className
    )

    if (asChild) {
      return (
        <Comp
          ref={ref}
          className={sharedClassName}
          aria-busy={isLoading || undefined}
          data-loading={isLoading ? "true" : undefined}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    return (
      <Comp
        ref={ref}
        className={sharedClassName}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading && (
          <span className="mr-2 inline-flex items-center">
            {spinner ?? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          </span>
        )}
        <span className="inline-flex items-center gap-2">
          {content}
        </span>
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

