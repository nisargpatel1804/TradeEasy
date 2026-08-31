import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  ToastIcon,
} from "./toast.jsx"
import { useToast } from "./use-toast.js"
import { CheckCircle2, Info, AlertTriangle, XCircle } from "lucide-react"

const variantIcons = {
  success: <CheckCircle2 className="h-4 w-4" />,
  destructive: <XCircle className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, icon, variant, ...props }) => {
        const renderIcon = icon ?? variantIcons[variant]

        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="flex w-full items-start gap-3">
              {renderIcon && <ToastIcon>{renderIcon}</ToastIcon>}
              <div className="grid gap-1 text-sm">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && <ToastDescription>{description}</ToastDescription>}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
