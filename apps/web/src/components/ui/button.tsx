import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: { default: "bg-green-700 text-white hover:bg-green-600", outline: "border border-neutral-700 bg-transparent hover:bg-neutral-800", ghost: "hover:bg-neutral-800", destructive: "bg-red-700 text-white hover:bg-red-600" },
    size: { default: "h-10 px-4 py-2", sm: "h-9 rounded-md px-3", lg: "h-11 rounded-md px-8", icon: "h-10 w-10" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => <button className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />);
Button.displayName = "Button";
