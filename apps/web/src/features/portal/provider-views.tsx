import { BadgeCheck, BriefcaseBusiness, CalendarDays, CheckCircle2, Wrench } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/lib/dictionaries";
import { getBookingsForProvider, getService, providers } from "@/lib/data";
import { formatDateTime, formatMoney, localizedPath, type Locale } from "@/lib/utils";
import { ButtonLink, Card, PageHeader, StatCard, StatusBadge, VerifiedMark } from "@/components/ui";

export function ProviderDashboard({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const provider = providers[0];
  const jobs = getBookingsForProvider(provider.id);
  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={provider.name} description={provider.bio[locale]} action={<VerifiedMark label={dict.providers.verified} />} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={BriefcaseBusiness} label={dict.portal.activeBookings} value={String(jobs.filter((job) => ["SCHEDULED", "IN_PROGRESS"].includes(job.status)).length)} />
        <StatCard icon={CalendarDays} label={dict.portal.upcomingVisits} value={String(jobs.length)} />
        <StatCard icon={CheckCircle2} label={dict.portal.jobs} value={String(provider.verifiedJobs)} />
        <StatCard icon={Wrench} label={dict.portal.services} value={String(provider.serviceSlugs.length)} />
      </div>
      <div className="mt-6 grid gap-5">
        {jobs.slice(0, 4).map((job) => {
          const service = getService(job.serviceSlug);
          return (
            <Card key={job.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-xs font-semibold text-muted">{job.code}</p><h2 className="mt-1 font-semibold text-navy">{service?.name[locale]}</h2><p className="mt-2 text-sm text-secondary">{formatDateTime(job.scheduledStart, locale)} · {formatMoney(job.quotedPaisa, locale)}</p></div>
              <div className="flex items-center gap-3"><StatusBadge status={job.status} label={dict.status[job.status]} /><ButtonLink href={localizedPath(locale, `/provider/jobs/${job.id}`)} variant="secondary">{dict.portal.activity}</ButtonLink></div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function ProviderServicesView({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const provider = providers[0];
  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.services} description={dict.portal.providerServicesDescription} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {provider.serviceSlugs.map((slug) => {
          const service = getService(slug);
          if (!service) return null;
          return <Card key={slug} className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-navy">{service.name[locale]}</h2><p className="mt-2 text-sm text-secondary">{service.description[locale]}</p></div><BadgeCheck className="size-5 shrink-0 text-emerald-700" /></div><p className="mt-4 border-t border-line pt-4 text-xs font-semibold uppercase tracking-[0.12em] text-primary-strong">{dict.providers.expertise} · {dict.common.verified}</p></Card>;
        })}
      </div>
    </div>
  );
}

export function ProviderProfileView({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const provider = providers[0];
  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.profile} />
      <Card className="mt-6 max-w-2xl p-6">
        <dl className="grid gap-4 text-sm"><div className="flex justify-between border-b border-line pb-3"><dt className="text-muted">{dict.providers.about}</dt><dd className="max-w-sm text-end text-navy">{provider.bio[locale]}</dd></div><div className="flex justify-between border-b border-line pb-3"><dt className="text-muted">{dict.providers.qualification}</dt><dd className="max-w-sm text-end text-navy">{provider.qualification[locale]}</dd></div><div className="flex justify-between"><dt className="text-muted">{dict.providers.areasServed}</dt><dd className="text-end text-navy">{provider.areas.length}</dd></div></dl>
        <Link href={localizedPath(locale, `/providers/${provider.slug}`)} className="mt-6 inline-block text-sm font-semibold text-primary-strong">{dict.providers.book}</Link>
      </Card>
    </div>
  );
}
