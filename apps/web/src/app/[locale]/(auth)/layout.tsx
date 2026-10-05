import type { ReactNode } from "react";
import { AuthBackground } from "@/features/auth/auth-background";
import "./auth.css";
/* Authentication layout: scrollable on mobile viewports, fixed-height on
   desktop. Every card in here is built to fit that fixed frame rather than
   grow past it - two-factor enrolment is the tallest of them, so it puts the
   code entry beside the QR instead of below it. */

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-auth-root
      className="relative min-h-dvh w-full overflow-y-auto overflow-x-hidden bg-slate-50 lg:h-dvh lg:max-h-dvh lg:overflow-hidden"
    >
      <AuthBackground />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1080px] flex-col justify-center px-4 py-8 sm:px-6 lg:h-full lg:max-h-dvh lg:py-2">
        {children}
      </div>
    </div>
  );
}
