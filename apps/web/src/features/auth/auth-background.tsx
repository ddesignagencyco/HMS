"use client";

/* Clean Dotted Grid Pattern with Soft Ambient Glowing Mesh Shadows
   for authentication screens. Minimalist, modern, and non-distracting. */
export function AuthBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
    >
      {/* 1. Ambient Glowing Mesh Shadows */}
      <div className="absolute -top-32 -left-32 size-[540px] rounded-full bg-blue-500/15 blur-[100px]" />
      <div className="absolute -bottom-32 -right-32 size-[580px] rounded-full bg-sky-400/15 blur-[110px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[680px] rounded-full bg-indigo-500/10 blur-[130px]" />

      {/* 2. Dotted Background Pattern with Soft Center Vignette */}
      <svg
        className="absolute inset-0 size-full opacity-60 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_50%,#000_20%,transparent_90%)]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="auth-dotted-pattern"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1.4" fill="#3b82f6" fillOpacity="0.32" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#auth-dotted-pattern)" />
      </svg>
    </div>
  );
}
