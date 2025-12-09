import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "../../utils/cn.js"

const TabsContext = React.createContext(null)

const Tabs = React.forwardRef(
  (
    {
      className,
      defaultValue,
      value,
      onValueChange,
      activationMode = "automatic",
      variant = "pill",
      children,
      ...props
    },
    ref
  ) => {
    const isControlled = value !== undefined
    const [internalValue, setInternalValue] = React.useState(defaultValue ?? null)

    const currentValue = isControlled ? value : internalValue

    const handleTabChange = React.useCallback(
      (newValue) => {
        if (!isControlled) {
          setInternalValue(newValue)
        }
        onValueChange?.(newValue)
      },
      [isControlled, onValueChange]
    )

    const contextValue = React.useMemo(
      () => ({
        value: currentValue,
        setValue: handleTabChange,
        activationMode,
        variant,
      }),
      [currentValue, handleTabChange, activationMode, variant]
    )

    return (
      <TabsContext.Provider value={contextValue}>
        <div ref={ref} className={cn("flex flex-col gap-6", className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    )
  }
)
Tabs.displayName = "Tabs"

const tabsListVariants = {
  pill: "inline-flex items-center gap-1 rounded-full bg-muted/50 p-1",
  underline: "flex border-b border-border/60",
  soft: "flex items-center gap-2 rounded-2xl bg-muted/40 p-1",
}

const TabsList = React.forwardRef(({ className, ...props }, ref) => {
  const context = React.useContext(TabsContext)
  const activeVariant = context?.variant ?? "pill"

  const handleKeyDown = (event) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"]
    if (!keys.includes(event.key)) return

    event.preventDefault()
    const tabs = Array.from(
      event.currentTarget.querySelectorAll('[role="tab"]:not([disabled])')
    )
    if (tabs.length === 0) return

    const currentIndex = tabs.indexOf(document.activeElement)
    let nextIndex = currentIndex

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    } else if (event.key === "Home") {
      nextIndex = 0
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1
    }

    tabs[nextIndex]?.focus()
    if (context?.activationMode === "automatic") {
      tabs[nextIndex]?.click()
    }
  }

  return (
    <div
      ref={ref}
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn(tabsListVariants[activeVariant] ?? tabsListVariants.pill, className)}
      {...props}
    />
  )
})
TabsList.displayName = "TabsList"

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        pill: "data-[state=active]:bg-background data-[state=active]:text-foreground",
        underline:
          "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground",
        soft: "data-[state=active]:bg-white data-[state=active]:shadow-sm",
      },
    },
    defaultVariants: {
      variant: "pill",
    },
  }
)

const TabsTrigger = React.forwardRef(({ className, value, children, ...props }, ref) => {
  const context = React.useContext(TabsContext)

  if (!context) {
    throw new Error("TabsTrigger must be used within Tabs")
  }

  const isActive = context.value === value
  const variant = context.variant ?? "pill"

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      onClick={() => context.setValue(value)}
      className={cn(
        tabsTriggerVariants({ variant }),
        !isActive && "text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
})
TabsTrigger.displayName = "TabsTrigger"

const TabsContent = React.forwardRef(({ className, value, children, ...props }, ref) => {
  const context = React.useContext(TabsContext)

  if (!context) {
    throw new Error("TabsContent must be used within Tabs")
  }

  const isActive = context.value === value

  if (!isActive) {
    return null
  }

  return (
    <div
      ref={ref}
      role="tabpanel"
      data-state="active"
      className={cn(
        "rounded-2xl border border-border/60 bg-card/70 p-4 text-sm shadow-sm",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }