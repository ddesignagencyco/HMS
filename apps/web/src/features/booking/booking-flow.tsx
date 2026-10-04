"use client";

import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Info, ShieldCheck, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import type { Area, Provider, Service } from "@/lib/types";
import { formatMoney, getText, localizedPath, type Locale } from "@/lib/utils";
import { Button, ButtonLink, Card, Checkbox, Container, Input, Label, PageBanner, RadioGroup, RadioGroupItem, Rating, Section, Textarea, VerifiedMark, buttonStyles } from "@/components/ui";
import { SelectField } from "@/components/select-field";
import { BookingStepper } from "@/features/booking/booking-stepper";

export function BookingFlow({ locale, dict, service, providers, areas }: { locale: Locale; dict: Dictionary; service: Service; providers: Provider[]; areas: Area[] }) {
  const [step, setStep] = useState(0);
  const [area, setArea] = useState("");
  const [house, setHouse] = useState("");
  const [notes, setNotes] = useState("");
  const [providerId, setProviderId] = useState("");
  const [slot, setSlot] = useState("");
  const [problem, setProblem] = useState("");
  const [payment, setPayment] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const steps = [dict.booking.step1, dict.booking.step2, dict.booking.step3, dict.booking.step4, dict.booking.step5, dict.booking.step6];
  const slots = ["09:00 – 10:30", "11:00 – 12:30", "14:00 – 15:30", "16:00 – 17:30"];
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const surcharge = service.emergency && emergency ? Math.round(service.basePricePaisa * 0.25) : 0;
  /* FR-PY-11: a cancellation fee owed by a cash customer shows on the next summary. */
  const outstanding = 50000;
  const total = service.basePricePaisa + service.visitFeePaisa + surcharge;

  function next() {
    setError("");
    if (step === 0 && (!area || !house.trim())) return setError(!area ? dict.booking.requiredArea : dict.booking.requiredHouse);
    if (step === 1 && !providerId) return setError(dict.booking.requiredProvider);
    if (step === 2 && !slot) return setError(dict.booking.requiredSlot);
    if (step === 3 && problem.trim().length < 10) return setError(dict.booking.requiredProblem);
    if (step === 4 && !agreed) return setError(dict.booking.requiredAgreement);
    if (step === 5 && !payment) return setError(dict.booking.requiredPayment);
    if (step === 5) return setSuccess(true);
    setStep((current) => current + 1);
  }

  if (success) {
    return (
      <>
        <PageBanner eyebrow={dict.booking.reference} title={dict.booking.successTitle} />
        <Section tone="surface" size="default">
          <Container>
            <Card className="mx-auto max-w-2xl p-8">
            <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-7" /></span>
            <p className="mt-5 text-sm leading-6 text-secondary">{dict.booking.successText}</p>
            </div>
            <dl className="mt-6 grid gap-3 rounded-[10px] bg-slate-50 p-5 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">{dict.common.service}</dt><dd className="mt-0.5 font-medium text-navy">{service.name[locale]}</dd></div>
              <div><dt className="text-muted">{dict.common.area}</dt><dd className="mt-0.5 font-medium text-navy">{getText(areas.find((item) => item.slug === area)?.name ?? areas[0].name, locale)}</dd></div>
              <div><dt className="text-muted">{dict.common.professional}</dt><dd className="mt-0.5 font-medium text-navy">{selectedProvider?.name ?? "-"}</dd></div>
              <div><dt className="text-muted">{dict.booking.slot}</dt><dd className="mt-0.5 font-medium text-navy">{slot}</dd></div>
              <div><dt className="text-muted">{dict.booking.total}</dt><dd className="mt-0.5 font-semibold text-navy">{formatMoney(total, locale)}</dd></div>
              <div><dt className="text-muted">{dict.booking.paymentMode}</dt><dd className="mt-0.5 font-medium text-navy">{payment === "ONLINE" ? dict.booking.online : dict.booking.cash}</dd></div>
            </dl>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <ButtonLink href={localizedPath(locale, "/account/bookings")}>{dict.booking.viewBooking}</ButtonLink>
              <ButtonLink href={localizedPath(locale, "/track")} variant="secondary">{dict.trackPage.titleLead}</ButtonLink>
            </div>
            </Card>
          </Container>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageBanner
        eyebrow={dict.brand.name}
        title={dict.booking.titleLead}
        titleAccent={service.name[locale]}
        action={
          <Link href={localizedPath(locale, `/services/${service.slug}`)} className={buttonStyles({ variant: "outline-light" })}>
            {dict.common.cancel}
          </Link>
        }
      />

      <Section tone="surface" size="default">
        <Container>
        <BookingStepper
          steps={steps.length}
          currentStep={step}
          labels={steps}
          onStepClick={(target) => {
            if (target < step) {
              setStep(target);
              setError("");
            }
          }}
        />

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="p-6">
          {step === 0 ? (
            <div>
              <h2 className="text-xl font-semibold text-navy">{dict.booking.addressTitle}</h2><p className="mt-1 text-sm text-secondary">{dict.booking.addressText}</p>
              <div className="mt-6 grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="booking-area">{dict.booking.areaLabel}</Label>
                  <SelectField id="booking-area" value={area} onChange={setArea} options={[{ value: "", label: dict.booking.chooseArea }, ...areas.map((item) => ({ value: item.slug, label: item.name[locale] }))]} placeholder={dict.booking.chooseArea} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="booking-house">{dict.booking.houseLabel}</Label>
                  <Input id="booking-house" value={house} onChange={(event) => setHouse(event.target.value)} placeholder={dict.booking.housePlaceholder} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="booking-notes">{dict.booking.notesLabel}</Label>
                  <Textarea id="booking-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={dict.booking.notesPlaceholder} />
                </div>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div>
              <h2 className="text-xl font-semibold text-navy">{dict.booking.providerTitle}</h2><p className="mt-1 text-sm text-secondary">{dict.booking.providerText}</p>
              <RadioGroup value={providerId} onValueChange={setProviderId} className="mt-6">
                {providers.length === 0 ? <p className="text-sm text-secondary">{dict.booking.noProviders}</p> : providers.map((provider) => (
                  <label key={provider.id} className={`flex cursor-pointer items-start gap-4 rounded-[12px] border p-4 transition ${providerId === provider.id ? "border-primary bg-blue-50" : "border-line hover:border-slate-300"}`}>
                    <RadioGroupItem value={provider.id} className="mt-1" />
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-[9px] bg-slate-100"><Image src={provider.image.url} alt="" fill sizes="56px" className="object-cover" /></span>
                    <span className="min-w-0 flex-1"><VerifiedMark label={dict.providers.verified} /><span className="mt-1 block font-semibold text-navy">{provider.name}</span><span className="mt-1 block text-xs text-secondary"><Rating value={provider.rating} count={provider.ratingCount} label={dict.common.rating} /></span></span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <h2 className="text-xl font-semibold text-navy">{dict.booking.scheduleTitle}</h2><p className="mt-1 text-sm text-secondary">{dict.booking.scheduleText}</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {slots.map((item) => <button key={item} type="button" onClick={() => setSlot(item)} className={`flex min-h-14 items-center gap-3 rounded-[10px] border px-4 text-sm font-semibold ${slot === item ? "border-primary bg-blue-50 text-primary-strong" : "border-line text-navy"}`}><CalendarDays className="size-4" />26 Sep · {item}</button>)}
              </div>
              {/* FR-CAT-06: the surcharge line only appears on an emergency-eligible service. */}
              {service.emergency ? (
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[10px] border border-line p-3.5 text-sm">
                  <input type="checkbox" checked={emergency} onChange={(event) => setEmergency(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
                  <span>
                    <span className="block font-semibold text-navy">{dict.common.emergency}</span>
                    <span className="mt-0.5 block text-secondary">{dict.booking.emergencySurchargeNote}</span>
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <h2 className="text-xl font-semibold text-navy">{dict.booking.detailsTitle}</h2><p className="mt-1 text-sm text-secondary">{dict.booking.detailsText}</p>
              <div className="mt-6 grid gap-2">
                <Label htmlFor="booking-problem">{dict.booking.problemLabel}</Label>
                <Textarea id="booking-problem" className="min-h-32" value={problem} onChange={(event) => setProblem(event.target.value)} placeholder={dict.booking.problemPlaceholder} />
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div>
              <h2 className="text-xl font-semibold text-navy">{dict.booking.reviewTitle}</h2><p className="mt-1 text-sm text-secondary">{dict.booking.reviewText}</p>
              <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
                {[service.name[locale], areas.find((item) => item.slug === area)?.name[locale] ?? "-", selectedProvider?.name ?? "-", slot].map((value, index) => <div key={index} className="flex justify-between gap-4 py-3"><dt className="text-muted">{steps[index]}</dt><dd className="text-end font-medium text-navy">{value}</dd></div>)}
              </dl>

              {/* FR-BK-04: estimate, visit fee, surcharge, outstanding fees and
                  the cancellation policy all render before confirm is allowed. */}
              <div className="mt-5 rounded-[12px] border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">{dict.booking.costBreakdown}</p>
                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-secondary">{dict.booking.estimate}</dt><dd className="font-medium text-navy tabular-nums">{formatMoney(service.basePricePaisa, locale)}</dd></div>
                  {service.visitFeePaisa > 0 ? <div className="flex justify-between gap-4"><dt className="text-secondary">{dict.booking.visitFee}</dt><dd className="text-navy tabular-nums">{formatMoney(service.visitFeePaisa, locale)}</dd></div> : null}
                  {service.emergency ? <div className="flex justify-between gap-4"><dt className="flex items-center gap-1.5 text-secondary"><Zap className="size-3.5 text-amber-500" aria-hidden="true" />{dict.booking.emergencySurcharge}</dt><dd className="text-navy tabular-nums">{formatMoney(surcharge, locale)}</dd></div> : null}
                  {outstanding > 0 ? <div className="flex justify-between gap-4"><dt className="text-rose-700">{dict.booking.outstandingFees}</dt><dd className="font-medium text-rose-700 tabular-nums">{formatMoney(outstanding, locale)}</dd></div> : null}
                  <div className="flex justify-between gap-4 border-t border-line pt-2.5"><dt className="font-semibold text-navy">{dict.common.total}</dt><dd className="text-lg font-semibold text-navy tabular-nums">{formatMoney(total, locale)}</dd></div>
                </dl>
              </div>

              <div className="mt-4 flex items-start gap-2.5 rounded-[9px] border border-amber-200 bg-amber-50 p-3.5 text-sm leading-6 text-amber-900">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{dict.booking.cancellationPolicy}</span>
              </div>

              <label className="mt-5 flex items-start gap-3 text-sm text-secondary">
                <Checkbox checked={agreed} onCheckedChange={(value) => setAgreed(value === true)} className="mt-0.5" />
                {dict.booking.agreeTerms}
              </label>
            </div>
          ) : null}

          {step === 5 ? (
            <div>
              <h2 className="text-xl font-semibold text-navy">{dict.booking.paymentTitle}</h2><p className="mt-1 text-sm text-secondary">{dict.booking.paymentText}</p>
              <RadioGroup value={payment} onValueChange={setPayment} className="mt-6">
                <label className={`flex cursor-pointer items-start gap-3 rounded-[12px] border p-4 transition ${payment === "cash" ? "border-primary bg-blue-50" : "border-line hover:border-slate-300"}`}>
                  <RadioGroupItem value="cash" className="mt-1" />
                  <span><span className="block font-semibold text-navy">{dict.booking.cash}</span><span className="mt-1 block text-sm text-secondary">{dict.booking.cashText}</span></span>
                </label>
                <label className={`flex cursor-pointer items-start gap-3 rounded-[12px] border p-4 transition ${payment === "online" ? "border-primary bg-blue-50" : "border-line hover:border-slate-300"}`}>
                  <RadioGroupItem value="online" className="mt-1" />
                  <span><span className="block font-semibold text-navy">{dict.booking.online}</span><span className="mt-1 block text-sm text-secondary">{dict.booking.onlineText}</span></span>
                </label>
              </RadioGroup>
            </div>
          ) : null}

          {error ? <p className="mt-5 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
            <Button type="button" variant="secondary" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}><ChevronLeft className="size-4 rtl:rotate-180" />{dict.common.back}</Button>
            <Button type="button" onClick={next}>{step === 5 ? dict.booking.confirm : dict.common.continue}<ChevronRight className="size-4 rtl:rotate-180" /></Button>
          </div>
        </Card>

        <aside className="h-fit overflow-hidden rounded-[14px] bg-navy-950 text-white lg:sticky lg:top-24">
          <div className="relative aspect-[16/9] overflow-hidden bg-navy-900">
            <Image src={service.image.url} alt={getText(service.image.alt, locale)} fill sizes="340px" style={{ objectPosition: service.focus }} className="object-cover opacity-90" />
          </div>
          <div className="p-5">
            <h2 className="font-semibold text-white">{service.name[locale]}</h2>
            <p className="mt-1 text-sm leading-6 text-white/70">{service.description[locale]}</p>
            <dl className="mt-5 grid gap-3 border-t border-white/15 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-white/60">{dict.booking.estimate}</dt><dd className="font-medium text-white">{formatMoney(service.basePricePaisa, locale)}</dd></div>
              {service.visitFeePaisa > 0 ? <div className="flex justify-between"><dt className="text-white/60">{dict.booking.visitFee}</dt><dd className="text-white/90">{formatMoney(service.visitFeePaisa, locale)}</dd></div> : null}
              <div className="flex justify-between border-t border-white/15 pt-3 text-base"><dt className="font-semibold text-white">{dict.booking.total}</dt><dd className="font-semibold text-yellow-500">{formatMoney(total, locale)}</dd></div>
            </dl>
            <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-white/60"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-yellow-500" />{dict.booking.onlineText}</p>
          </div>
        </aside>
      </div>
        </Container>
      </Section>
    </>
  );
}
