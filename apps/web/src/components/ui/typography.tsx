import { SectionHeader } from "@/components/ui/section";

export function SectionHeading({
  eyebrow,
  title,
  titleAccent,
  description,
  action,
  variant = "split",
  tone = "light",
  accentTone = "light",
  className,
}: {
  eyebrow?: string;
  title: string;
  titleAccent?: string;
  accentTone?: "light" | "dark";
  description?: string;
  action?: React.ReactNode;
  variant?: "left" | "split" | "center" | "full";
  tone?: "light" | "surface" | "dark";
  className?: string;
}) {
  return (
    <SectionHeader
      eyebrow={eyebrow}
      title={title}
      titleAccent={titleAccent}
      description={description}
      action={action}
      variant={variant}
      tone={tone}
      accentTone={accentTone}
      className={className}
    />
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 border-b border-line pb-7 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary-strong">
            <span aria-hidden="true" className="h-px w-6 bg-yellow-500" />
            {eyebrow}
          </p>
        ) : null}
        <h1 className="title-page text-navy">{title}</h1>
        {description ? <p className="mt-3 text-pretty text-sm leading-6 text-secondary">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
