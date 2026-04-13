import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
        destructive: "",
        outline: "",
        secondary: "",
        ghost: "",
        link: "",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    const variantStyles: Record<string, React.CSSProperties> = {
      default: { backgroundColor: "#111", color: "#fff" },
      destructive: { backgroundColor: "#ef4444", color: "#fff" },
      outline: { border: "1px solid #e5e7eb", backgroundColor: "transparent" },
      secondary: { backgroundColor: "#f3f4f6", color: "#1f2937" },
      ghost: {},
      link: { color: "#111", textDecoration: "underline" },
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        style={variantStyles[variant || "default"]}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
