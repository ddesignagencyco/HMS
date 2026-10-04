import { Heart, Repeat2, Sparkles, CalendarClock, CheckCircle2, MapPin } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { getService, providers, reviews } from "@/lib/data";
import { formatDate, formatMoney, formatNumber, getText, localizedPath, type Locale } from "@/lib/utils";
import { ButtonLink, Card, PageHeader, StatCard } from "@/components/ui";

/* Demo favourites: the two professionals this customer has saved, plus one
   more drawn from the approved pool so the empty state is reachable. */
const favouriteIds = ["prv-ahmad-plumber", "prv-sana-sanitary"];

export function CustomerFavourites({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const saved = providers.filter((item) => favouriteIds.includes(item.id));

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.customer}
        title={dict.portal.favourites}
        description={dict.portal.favouritesText}
        action={<ButtonLink href={localizedPath(locale, "/providers")}>{dict.home.browsePros}</ButtonLink>}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Heart} label={dict.portal.favourites} value={String(saved.length)} />
        <StatCard icon={CheckCircle2} label={dict.portal.totalJobs} value={String(saved.reduce((sum, item) => sum + item.verifiedJobs, 0))} />
        <StatCard icon={MapPin} label={dict.providers.areasServed} value={String(new Set(saved.flatMap((item) => item.areas)).size)} />
      </div>

      {saved.length === 0 ? (
        <Card className="mt-6 px-6 py-14 text-center">
          <Heart className="mx-auto size-8 text-slate-300" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-navy">{dict.portal.noFavourites}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">{dict.portal.noFavouritesText}</p>
          <ButtonLink href={localizedPath(locale, "/providers")} className="mt-5">{dict.home.browsePros}</ButtonLink>
        </Card>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {saved.map((provider) => {
            const last = reviews.find((review) => review.providerId === provider.id);
            const top = provider.serviceSlugs.map((slug) => getService(slug)).filter(Boolean).slice(0, 2);
            return (
              <Card key={provider.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[17px] font-semibold tracking-[-0.025em] text-navy">{provider.name}</h2>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                      {dict.providers.experience.replace("{years}", String(provider.experienceYears))}
                    </p>
                  </div>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600" aria-hidden="true">
                    <Heart className="size-4 fill-rose-600" />
                  </span>
                </div>

                <dl className="mt-4 grid gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <dt className="sr-only">{dict.common.rating}</dt>
                    <dd className="font-semibold text-navy tabular-nums">{provider.rating.toFixed(1)}</dd>
                    <span className="text-muted">({formatNumber(provider.ratingCount, locale)})</span>
                    <span className="text-muted">·</span>
                    <dd className="text-secondary">{dict.providers.jobs.replace("{count}", formatNumber(provider.verifiedJobs, locale))}</dd>
                  </div>
                </dl>

                {last ? (
                  <p className="mt-4 line-clamp-2 border-s-2 border-primary/40 ps-3 text-sm leading-6 text-secondary">
                    &ldquo;{last.body}&rdquo;
                    <span className="mt-1 block text-xs text-muted">{formatDate(last.createdAt, locale)}</span>
                  </p>
                ) : null}

                {top.length > 0 ? (
                  <ul className="mt-4 flex flex-wrap gap-1.5">
                    {top.map((service) => (
                      <li key={service!.slug} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-secondary">
                        {getText(service!.name, locale)} · {formatMoney(service!.basePricePaisa, locale)}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-5 flex gap-2 border-t border-line pt-4">
                  <ButtonLink href={localizedPath(locale, `/providers/${provider.slug}`)} className="flex-1">{dict.providers.book}</ButtonLink>
                  <ButtonLink href={localizedPath(locale, `/book/${top[0]?.slug ?? "leak-detection-and-repair"}`)} variant="secondary" className="flex-1">{dict.nav.bookService}</ButtonLink>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Maintenance plans — entitlements, renewal and cancellation
 * (FR-MP-04: cancel refunds unused visits pro-rata)
 * ------------------------------------------------------------------ */

const plans = [
  { id: "care", name: "care", price: 490000, visitsTotal: 2, visitsUsed: 1, renews: "2027-03-14", status: "active" },
  { id: "plus", name: "plus", price: 890000, visitsTotal: 4, visitsUsed: 3, renews: "2027-03-02", status: "active" },
] as const;

export function CustomerPlans({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const totalPaid = plans.reduce((sum, plan) => sum + plan.price, 0);
  const totalRemaining = plans.reduce((sum, plan) => sum + (plan.visitsTotal - plan.visitsUsed), 0);

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.customer}
        title={dict.portal.plans}
        description={dict.portal.plansText}
        action={<ButtonLink href={localizedPath(locale, "/plans")}>{dict.plansPage.comparePlans}</ButtonLink>}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Repeat2} label={dict.portal.activePlans} value={String(plans.length)} />
        <StatCard icon={CalendarClock} label={dict.portal.remainingVisits} value={String(totalRemaining)} />
        <StatCard icon={Sparkles} label={dict.portal.paidToDate} value={formatMoney(totalPaid, locale)} />
      </div>

      <div className="mt-6 grid gap-5">
        {plans.map((plan) => {
          const remaining = plan.visitsTotal - plan.visitsUsed;
          const proRata = Math.round((plan.price * remaining) / plan.visitsTotal);
          return (
            <Card key={plan.id} className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-[19px] font-semibold tracking-[-0.03em] text-navy">{dict.plansPage.names[plan.name]}</h2>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      {dict.portal.active}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-secondary">
                    {dict.portal.renews} {formatDate(plan.renews, locale)}
                  </p>
                </div>
                <p className="text-end">
                  <span className="block text-xl font-semibold tracking-[-0.03em] text-navy">{formatMoney(plan.price, locale)}</span>
                  <span className="text-xs text-muted">{dict.plansPage.perYear}</span>
                </p>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{dict.portal.visitsUsed} {plan.visitsUsed} / {plan.visitsTotal}</span>
                  <span>{dict.portal.remainingVisits} {remaining}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(plan.visitsUsed / plan.visitsTotal) * 100}%` }} />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <ButtonLink href={localizedPath(locale, "/services")} className="flex-1">{dict.portal.bookRemainingVisit}</ButtonLink>
                <ButtonLink href={localizedPath(locale, "/how-verification-works")} variant="secondary" className="flex-1">{dict.nav.howWeVerify}</ButtonLink>
                <button
                  type="button"
                  title={dict.portal.cancelPlanHint.replace("{amount}", formatMoney(proRata, locale))}
                  className="min-h-11 rounded-[9px] border border-line px-4 text-sm font-semibold text-secondary transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                >
                  {dict.portal.cancelPlan}
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.portal.plansPolicy}</h2>
        <ul className="mt-4 grid gap-2.5">
          {[
            dict.portal.policy1,
            dict.portal.policy2,
            dict.portal.policy3,
            dict.portal.policy4,
          ].map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-sm leading-6 text-secondary">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
