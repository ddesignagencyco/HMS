import { AtmosphericBackground } from "@/components/layout/atmospheric-background";
import { Container } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/* Every inner page opens on the same band: same navy, same
   eyebrow -> title -> description rhythm, same type ramp. Only the
   content changes, so the pages feel like one product rather than nine.

   This is deliberately a plain section rather than the Section primitive: a
   banner may hang a control panel over its own bottom edge, and the Section
   primitive clips to contain its wave. The band still reserves the room that
   overhang needs, so the page below never has to compensate. */

/* One fixed height rhythm for banners across all inner pages (plans, providers,
   services, how-verification-works, track, privacy, terms, contact, etc.),
   ensuring the navy blue header stays rock-solid and uniform across navigation. */
const sizeClass = {
  compact: "min-h-[190px] sm:h-[220px] lg:h-[230px] py-6 sm:py-0",
  default: "min-h-[190px] sm:h-[220px] lg:h-[230px] py-6 sm:py-0",
  feature: "min-h-[190px] sm:h-[220px] lg:h-[230px] py-6 sm:py-0",
} as const;

export function PageBanner({
  eyebrow,
  title,
  titleAccent,
  description,
  action,
  children,
  className,
  size = "default",
}: {
  eyebrow?: string;
  title: string;
  titleAccent?: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  size?: keyof typeof sizeClass;
}) {
  return (
    <section
      className={cn(
        "relative flex flex-col justify-center overflow-x-clip bg-navy-950 text-white",
        sizeClass[size],
        children && "pb-10 pt-8 sm:pb-12 sm:pt-10 lg:pb-[120px]",
        className,
      )}
    >
      <AtmosphericBackground variant="hero" />

      <Container className="relative">
        <div className="header-stack-split items-center">
          <div className="max-w-2xl">
            {eyebrow ? <p className="eyebrow eyebrow-dark">{eyebrow}</p> : null}
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:mt-2.5 sm:text-3xl lg:text-[32px] text-balance leading-tight">
              {title}
              {titleAccent ? <span className="text-yellow-400 font-bold"> {titleAccent}</span> : null}
            </h1>
            {description ? (
              <p className="mt-2 max-w-xl text-pretty text-xs leading-relaxed text-slate-300/85 sm:text-sm lg:max-w-2xl lg:text-[15px] font-normal">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </Container>

      {children ? (
        <div className="absolute inset-x-0 bottom-0 z-20 translate-y-1/2">
          <Container>{children}</Container>
        </div>
      ) : null}
    </section>
  );
}
