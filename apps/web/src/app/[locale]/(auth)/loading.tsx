export default function AuthLoading() {
  return (
    <div className="relative mx-auto flex w-full max-w-[1040px] flex-col justify-center animate-pulse">
      {/* Split Card Skeleton matching the exact auth page dimensions */}
      <div className="relative grid rounded-[16px] sm:rounded-[20px] border border-slate-200/90 bg-white shadow-[0_20px_60px_-15px_rgba(15,23,42,0.1)] lg:grid-cols-2 lg:min-h-[605px] lg:overflow-hidden">
        {/* Left Column: Form Skeleton */}
        <div className="flex flex-col justify-center px-5 py-6 sm:px-8 sm:py-7 lg:px-9.5 lg:py-7">
          <div>
            {/* Logo Skeleton */}
            <div className="mb-3 flex items-center gap-2.5">
              <div className="size-9 shrink-0 rounded-lg bg-slate-200" />
              <div className="space-y-1.5">
                <div className="h-3.5 w-36 rounded bg-slate-200" />
                <div className="h-2 w-28 rounded bg-slate-100" />
              </div>
            </div>

            {/* Heading Skeleton */}
            <div className="mb-4">
              <div className="h-7 w-48 rounded-md bg-slate-200" />
              <div className="mt-2 h-3.5 w-72 max-w-full rounded bg-slate-100" />
            </div>

            {/* Inputs Skeleton */}
            <div className="grid gap-3.5">
              <div className="space-y-1.5">
                <div className="h-3 w-20 rounded bg-slate-200" />
                <div className="h-10 w-full rounded-[8px] border border-slate-200/60 bg-slate-50" />
              </div>

              <div className="space-y-1.5">
                <div className="h-3 w-24 rounded bg-slate-200" />
                <div className="h-10 w-full rounded-[8px] border border-slate-200/60 bg-slate-50" />
              </div>

              {/* Submit Button Skeleton */}
              <div className="mt-1 h-10 w-full rounded-[8px] bg-blue-600/30" />

              {/* Social Buttons Divider & Skeletons */}
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-slate-200" />
                  <div className="h-2.5 w-24 rounded bg-slate-200" />
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="h-9 rounded-[9px] border border-slate-200/60 bg-slate-50" />
                  <div className="h-9 rounded-[9px] border border-slate-200/60 bg-slate-50" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Visual Image Skeleton */}
        <div className="relative hidden overflow-hidden lg:block bg-gradient-to-br from-slate-100 via-slate-200 to-blue-100/30 min-h-[580px] lg:min-h-[605px]">
          {/* Subtle Ambient Blueprint Node Placeholder */}
          <div className="absolute inset-0 flex items-center justify-center opacity-30">
            <div className="size-48 rounded-full border border-blue-300/40 bg-blue-400/10" />
          </div>

          {/* Bottom Curved Wave Skeleton */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col justify-end p-5 xl:p-6 bg-gradient-to-t from-blue-900/70 via-blue-900/50 to-transparent">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1.5">
                <div className="h-4 w-44 rounded bg-white/40" />
                <div className="h-2.5 w-60 rounded bg-white/20" />
              </div>
              <div className="h-7 w-24 rounded-[8px] bg-white/25" />
            </div>
            <div className="mt-2.5 flex items-center gap-3 border-t border-white/10 pt-2">
              <div className="h-2 w-20 rounded bg-white/20" />
              <div className="h-2 w-20 rounded bg-white/20" />
              <div className="h-2 w-20 rounded bg-white/20" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
