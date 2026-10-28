import { ArrowRight } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[9px] text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 active:translate-y-0 disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:-translate-y-px hover:bg-primary-strong hover:shadow-[0_2px_6px_rgba(15,23,42,0.10)]",
        primary: "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:-translate-y-px hover:bg-primary-strong hover:shadow-[0_2px_6px_rgba(15,23,42,0.10)]",
        secondary: "border border-line bg-white text-navy transition-colors hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50",
        quiet: "text-primary-strong hover:bg-blue-50",
        outline: "border border-line bg-white text-navy hover:-translate-y-px hover:bg-slate-50",
        destructive: "bg-destructive text-destructive-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:-translate-y-px hover:bg-destructive/90",
        danger: "bg-destructive text-destructive-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:-translate-y-px hover:bg-destructive/90",
        accent: "bg-yellow-500 text-navy-950 shadow-[0_1px_2px_rgba(7,21,47,0.18)] hover:-translate-y-px hover:bg-yellow-400",
        "outline-light": "border border-white/25 bg-transparent text-white hover:-translate-y-px hover:border-white/50 hover:bg-white/5",
        ghost: "text-secondary hover:-translate-y-px hover:bg-slate-50 hover:text-navy",
        "ghost-light": "text-slate-300 hover:-translate-y-px hover:bg-white/5 hover:text-white",
        link: "text-primary-strong underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-5",
        sm: "min-h-9 rounded-[8px] px-3 text-xs",
        lg: "min-h-12 px-6 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export function TextLink({
  href,
  children,
  className,
  showArrow = true,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  showArrow?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "link-motion group/link inline-flex min-h-11 items-center gap-1.5 rounded-[4px] py-1 text-sm font-semibold text-primary-strong transition-colors duration-200 hover:text-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100",
        className,
      )}
    >
      {children}
      {showArrow ? (
        <ArrowRight className="link-arrow size-4 shrink-0 transition-transform duration-200 ease-out rtl:rotate-180" aria-hidden="true" />
      ) : null}
    </Link>
  );
}

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function buttonStyles(options: { variant?: "primary" | "secondary" | "quiet" | "outline" | "ghost" | "danger" | "accent" | "outline-light" | "ghost-light"; size?: "default" | "sm" | "lg"; className?: string } = {}) {
  const { variant = "primary", size, className } = options;
  return cn(buttonVariants({ variant, size }), className);
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size,
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "outline" | "ghost" | "danger" | "accent" | "outline-light" | "ghost-light";
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)}>
      {children}
    </Link>
  );
}
