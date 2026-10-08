import { cn } from "@/lib/utils";

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  vectorEffect: "non-scaling-stroke" as const,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const thin = { ...base, strokeWidth: 1 };

/* The decorative vocabulary is small and deliberate. Every section is assigned
   exactly one drawing so nothing on the page looks arbitrary:

     Hero .............. quiet (no drawing)
     Trust / Metrics ... quiet (no drawing)
     Popular Services .. quiet (no drawing)
     Process ........... service route / circuit
     Professionals ..... verification geometry
     Managed Journey ... service document / plan sheet
     Reviews ........... construction quotation mark
     FAQ ............... none
     Final CTA ......... none — the closing line carries itself on scale and
                          contrast alone, with no drawing to soften it

   No drawing on this page uses a crossed pair of strokes. Registration marks
   and arrow crosses read as random noise at watermark opacity, so every
   terminal mark is a T or a single jamb line instead. */

/* Service route: a dispatch circuit with two stops. viewBox 200x120. */
export function RouteCircuit({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 200 120" className={cn("pointer-events-none select-none", className)} {...thin}>
      <path d="M20 20h44a16 16 0 0 1 16 16v48a16 16 0 0 0 16 16h64a16 16 0 0 0 16-16V36a16 16 0 0 1 16-16h8" />
      <circle cx="20" cy="20" r="7" />
      <circle cx="180" cy="20" r="7" />
      <circle cx="52" cy="20" r="4" />
      <circle cx="148" cy="100" r="4" />
      <path d="M20 13V2M180 13V2" />
    </svg>
  );
}

/* Verification geometry: the badge, drawn rather than set in type.
   viewBox 96x96. */
export function VerificationGeometry({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 96 96" className={cn("pointer-events-none select-none", className)} {...thin}>
      <path d="M48 6 84 22v26c0 20-15 34-36 42C27 82 12 68 12 48V22Z" />
      <path d="m34 47 10 11 20-23" />
    </svg>
  );
}

/* Service document: a job sheet with a checklist and a signed line.
   viewBox 200x260. */
export function ServiceDocument({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 200 260" className={cn("pointer-events-none select-none", className)} {...thin}>
      <path d="M28 8h96l48 48v196H28Z" />
      <path d="M124 8v48h48" />
      <path d="M48 92h64M48 118h104M48 144h80" />
      <path d="M46 168h8v8h-8zM46 194h8v8h-8z" />
      <path d="M66 172h86M66 198h64" />
      <path d="M120 232c8-12 16 8 24-4s14 10 24-2" />
      <path d="M172 56v40" />
    </svg>
  );
}

/* Quotation mark, drawn as two solid blocks so it reads as a mark and not as
   a glyph. viewBox 120x100. Background decoration only. */
export function QuotationMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 120 100" className={cn("pointer-events-none select-none", className)} fill="currentColor">
      <path d="M6 62V44C6 25 18 10 39 4v14c-10 4-16 11-17 21h18v23Z" />
      <path d="M66 62V44C66 25 78 10 99 4v14c-10 4-16 11-17 21h18v23Z" />
    </svg>
  );
}

