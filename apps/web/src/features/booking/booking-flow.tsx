"use client";

import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Info, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, localizedPath, type Locale } from "@/lib/utils";
import { Button, ButtonLink, Card, Checkbox, Container, Label, PageBanner, RadioGroup, RadioGroupItem, Section, Textarea, buttonStyles } from "@/components/ui";
import { SelectField } from "@/components/select-field";
import { money } from "@/features/catalogue/pricing";
import { formatSlotTime } from "@/features/search/location";
import { addDays, SLOT_WINDOW_DAYS, toApiDate } from "@/features/search/types";
import { useProviderSearch } from "@/features/search/queries";
import { useProviderSlots } from "@/features/search/queries";
import { BookingStepper } from "@/features/booking/booking-stepper";
import { AddressStep } from "@/features/booking/address-step";
import { DayPicker, ProviderChoiceStep, RequestedWindowPicker, formatDay, isAutoAssign, type ProviderChoice, type ScheduleRequest } from "@/features/booking/provider-choice";
import { useCreateBooking, useQuote } from "@/features/booking/queries";
import { useIssueOptions } from "@/features/catalogue/queries";
import { isAwaitingProvider, isHeldPayment } from "@/features/booking/status";
import type { CreatedBooking, PaymentMode, Quote } from "@/features/booking/api";
import type { CatalogueService } from "@/features/catalogue/api";

/* The booking flow, against the live API.

   The order of the steps is driven by what the API needs, not by what reads
   best. `POST /bookings` requires an address, a professional-or-auto-assign, a
   start and an end, and an emergency flag; the price is only knowable once the
   service, the professional and the emergency flag are settled, so the quote is
   read at the review step rather than guessed at the top.

   The one thing this flow deliberately refuses to do is show a total it computed
   itself. Every figure on the review step comes from `POST /bookings/quote`,
   which is the same `PricingService.price()` that creates the booking — so what
   the customer agreed to and what they are charged can only differ if the
   basket changed. */

const STEPS = 6;

type Basket = {
  addressId: string | null;
  choice: ProviderChoice | null;
  /** Only used for a named professional; null when auto-assigning. */
  slot: { start: string; end: string } | null;
  /** Only used when auto-assigning. */
  request: ScheduleRequest | null;
  /** One of the service's own faults, from the API. Null until one is chosen. */
  issueOptionId: number | null;
  /** Anything the customer adds beyond the chosen fault. Optional. */
  problem: string;
  emergency: boolean;
  agreed: boolean;
  paymentMode: PaymentMode | null;
};

const EMPTY: Basket = {
  addressId: null,
  choice: null,
  slot: null,
  request: null,
  issueOptionId: null,
  problem: "",
  emergency: false,
  agreed: false,
  paymentMode: null,
};

export function BookingFlow({
  locale,
  dict,
  service,
  initialProviderId,
  initialDate,
  initialStart,
}: {
  locale: Locale;
  dict: Dictionary;
  service: CatalogueService;
  /** Carried in from the availability panel, so a chosen slot survives the hop. */
  initialProviderId: string | null;
  initialDate: string | null;
  initialStart: string | null;
}) {
  const [step, setStep] = useState(0);
  /* A professional carried in from a provider profile is preselected, but the
     address is not: only the customer's own saved address can supply the point
     that `/search/providers` needs, and a booking cannot be created without one
     anyway. So step 1 is still answered first even when a provider is known. */
  const [basket, setBasket] = useState<Basket>(() =>
    initialProviderId === null ? EMPTY : { ...EMPTY, choice: { kind: "provider", providerId: initialProviderId } },
  );
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [created, setCreated] = useState<CreatedBooking | null>(null);
  const [slotTaken, setSlotTaken] = useState(false);
  const [localError, setLocalError] = useState("");
  const quote = useQuote(null, locale);
  const createBooking = useCreateBooking(locale);

  const update = (patch: Partial<Basket>): void => setBasket((current) => ({ ...current, ...patch }));

  /* The professional list is a search, and a search needs a point. The chosen
     address carries one, which is the first honest coordinate this flow has. */
  const providers = useProviderSearch(
    point === null || basket.addressId === null
      ? null
      : { serviceSlug: service.slug, lat: point.lat, lng: point.lng },
    locale,
  );

  const chosenProviderId = basket.choice?.kind === "provider" && basket.choice.providerId !== "" ? basket.choice.providerId : null;
  const autoAssign = isAutoAssign(basket.choice);

  /* A carried-in date is honoured when it is one of the offered days. Anything
     else — a past date, a hand-edited `?date=`, a date past the 14-day window —
     falls back to today, because the API would reject it and the failure would
     read as the platform's rather than the URL's. */
  const [selectedDate, setSelectedDate] = useState<string>(() => (initialDate !== null && initialDate <= toApiDate(addDays(new Date(), SLOT_WINDOW_DAYS - 1)) ? initialDate : toApiDate(new Date())));

  const slots = useProviderSlots(chosenProviderId, service.id, chosenProviderId === null ? null : selectedDate, locale);

  /* A professional and a time carried in from a profile's availability panel
     preselect the matching slot.

     Derived during render rather than written from an effect: the slot is not new
     information, it is the one the customer already chose arriving from the URL,
     and it can only be applied once `/slots` has confirmed the start is still
     free. An effect would set state after the first paint, which costs an extra
     render and — more importantly — would briefly show an empty step as though
     nothing had been carried over. */
  const carriedSlot = useMemo(() => {
    if (initialProviderId === null || initialStart === null) return null;
    if (chosenProviderId !== initialProviderId) return null;
    return slots.data?.items.find((slot) => slot.start === initialStart) ?? null;
  }, [chosenProviderId, initialProviderId, initialStart, slots.data]);

  /* What the flow actually holds. The carried slot applies only while the
     customer has not chosen or changed a time themselves — after that it is
     theirs, and a refetch must not move the selection under their finger. */
  const effectiveSlot = basket.slot ?? carriedSlot;

  const days = useMemo(() => {
    const tag = locale === "ur" ? "ur-PK" : "en-PK";
    return Array.from({ length: SLOT_WINDOW_DAYS }, (_, index) => {
      const date = addDays(new Date(), index);
      return { value: toApiDate(date), label: new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short" }).format(date) };
    });
  }, [locale]);

  const quoteInput =
    basket.addressId === null || basket.choice === null
      ? null
      : {
          serviceId: service.id,
          isEmergency: basket.emergency,
          ...(chosenProviderId === null ? {} : { providerId: chosenProviderId }),
        };

  /**
   * The quote is read on the way into the review step, with `mutateAsync`, so the
   * review step cannot render a figure that is not in hand. It is deliberately
   * not cached: it is priced against the signed-in customer's outstanding
   * balance, so a remembered quote is a quote for a basket that no longer
   * exists. Any change to the basket resets it.
   */
  const readQuote = async (): Promise<Quote | null> => {
    if (quoteInput === null) return null;
    try {
      return await quote.mutateAsync(quoteInput);
    } catch {
      return null;
    }
  };

  const scheduled = basket.slot ?? basket.request;
  const emergencyAllowed = service.isEmergencyEligible;
  /* The mutation's data is `Quote | undefined`; every render below deals in
     `Quote | null`, so an absent quote is one shape rather than two. */
  const currentQuote = quote.data ?? null;

  const validate = (): string => {
    if (step === 0 && basket.addressId === null) return dict.booking.requiredAddress;
    if (step === 1 && basket.choice === null) return dict.booking.requiredProvider;
    /* A named professional must have a real slot; auto-assign needs a requested
       window. Neither falls back to the other's rule. */
    if (step === 2 && effectiveSlot === null && basket.request === null) return dict.booking.requiredSlot;
    /* The chosen fault is the required answer. The free-text box is the extra
       detail on top of it, so it cannot stand in for a missing choice. */
    if (step === 3 && basket.issueOptionId === null) return dict.booking.requiredIssueOption;
    if (step === 4 && (!basket.agreed || quote.data === null)) return dict.booking.requiredAgreement;
    if (step === 5 && basket.paymentMode === null) return dict.booking.requiredPayment;
    return "";
  };

  const goNext = async (): Promise<void> => {
    setLocalError("");
    setSlotTaken(false);

    const complaint = validate();
    if (complaint !== "") {
      setLocalError(complaint);
      return;
    }

    /* Reading the quote happens on the way into the review step, and the review
       step is disabled until it has arrived. */
    if (step === 3) {
      const priced = await readQuote();
      if (priced === null) {
        setLocalError(dict.booking.quoteFailed);
        return;
      }
    }

    if (step < STEPS - 1) {
      setStep((current) => current + 1);
      return;
    }

    if (basket.addressId === null || basket.choice === null || scheduled === null || basket.paymentMode === null) return;

    try {
      const booking = await createBooking.mutateAsync({
        serviceId: service.id,
        addressId: basket.addressId,
        scheduledStart: scheduled.start,
        scheduledEnd: scheduled.end,
        paymentMode: basket.paymentMode,
        ...(basket.issueOptionId === null ? {} : { issueOptionId: basket.issueOptionId }),
        ...(basket.problem.trim() === "" ? {} : { problemText: basket.problem.trim() }),
        ...(chosenProviderId === null ? {} : { providerId: chosenProviderId }),
        ...(emergencyAllowed && basket.emergency ? { isEmergency: true } : {}),
      });
      setCreated(booking);
    } catch (error) {
      /* 409 SLOT_TAKEN is the documented outcome of two people taking the same
         slot. It is not a generic failure: the customer goes back to the time
         step with fresh availability rather than being told to try again. */
      if (isSlotTaken(error)) {
        setSlotTaken(true);
        setStep(2);
        update({ slot: null, request: null });
        void slots.refetch();
        return;
      }
      setLocalError(createFailure(error, dict));
    }
  };

  const goBack = (): void => {
    setLocalError("");
    if (step > 0) setStep((current) => current - 1);
  };

  const backToStep = (target: number): void => {
    setLocalError("");
    setStep(target);
  };

  if (created !== null) {
    return <BookingConfirmed locale={locale} dict={dict} service={service} booking={created} />;
  }

  const canContinue = validate() === "";

  return (
    <>
      <PageBanner
        eyebrow={dict.brand.name}
        title={dict.booking.titleLead}
        titleAccent={locale === "ur" ? service.nameUr : service.nameEn}
        action={
          <Link href={localizedPath(locale, `/services/${service.slug}`)} className={buttonStyles({ variant: "outline-light" })}>
            {dict.common.cancel}
          </Link>
        }
      />

      <Section tone="surface" size="default">
        <Container>
          <BookingStepper
            steps={STEPS}
            currentStep={step}
            labels={[dict.booking.step1, dict.booking.step2, dict.booking.step3, dict.booking.step4, dict.booking.step5, dict.booking.step6]}
            onStepClick={(target) => {
              /* Backwards only. Going forward past the review step without a
                 quote would mean confirming a figure nobody has seen. */
              if (target < step) backToStep(target);
            }}
          />

          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
            <Card className="p-6">
              {step === 0 ? (
                <AddressStep
                  locale={locale}
                  dict={dict}
                  addressId={basket.addressId}
                  onSelect={(addressId, addressPoint) => {
                    setPoint(addressPoint);
                    /* Choosing the address moves the search point, so the
                       professional list, the slots and the quote are all stale.
                       Drop the ones that depend on it rather than showing a quote
                       priced for a different place.

                       A professional carried in from a profile is the exception:
                       the customer already chose it, and discarding it here would
                       silently undo the hand-off they made one click earlier. */
                    update({
                      addressId,
                      choice: basket.choice?.kind === "provider" && basket.choice.providerId === initialProviderId ? basket.choice : null,
                      slot: null,
                      request: null,
                    });
                    quote.reset();
                  }}
                />
              ) : null}

              {step === 1 ? (
                <ProviderChoiceStep
                  locale={locale}
                  dict={dict}
                  choice={basket.choice}
                  providers={providers.data?.items ?? []}
                  searching={providers.isFetching}
                  hasLocation={point !== null && basket.addressId !== null}
                  onChange={(choice) => {
                    update({ choice, slot: null, request: null });
                    quote.reset();
                  }}
                />
              ) : null}

              {step === 2 ? (
                <ScheduleStep
                  locale={locale}
                  dict={dict}
                  service={service}
                  autoAssign={autoAssign}
                  selectedDate={selectedDate}
                  days={days}
                  selected={effectiveSlot ?? basket.request}
                  slotTaken={slotTaken}
                  slotError={slots.isError ? dict.booking.slotsError : null}
                  onRetrySlots={() => void slots.refetch()}
                  onDateChange={(date) => {
                    setSelectedDate(date);
                    update({ slot: null, request: null });
                  }}
                  onSlot={(slot) => update({ slot, request: null })}
                  onRequest={(request) => update({ request, slot: null })}
                  emergencyAllowed={emergencyAllowed}
                  emergency={basket.emergency}
                  onEmergency={(value) => {
                    update({ emergency: value });
                    quote.reset();
                  }}
                  emergencyLabel={dict.common.emergency}
                  emergencyNote={dict.booking.emergencyNote}
                  slotTimes={slots.data?.items ?? []}
                  slotsLoading={slots.isPending}
                  slotsEmpty={slots.isSuccess && slots.data.items.length === 0}
                />
              ) : null}

              {step === 3 ? (
                <ProblemStep
                  locale={locale}
                  dict={dict}
                  serviceSlug={service.slug}
                  issueOptionId={basket.issueOptionId}
                  notes={basket.problem}
                  onSelect={(issueOptionId) => {
                    update({ issueOptionId });
                    /* The complaint on screen was "choose the problem"; they just
                       did. Leaving it up would argue with the answer. */
                    setLocalError("");
                  }}
                  onNotes={(value) => update({ problem: value })}
                />
              ) : null}

              {step === 4 ? (
                <ReviewStep
                  locale={locale}
                  dict={dict}
                  service={service}
                  basket={basket}
                  /* The public search row publishes no name (§2.2 of the
                     handoff), so the review step names the choice by its
                     qualification rather than inventing a person's name. */
                  chosenProviderName={
                    providers.data?.items.find((item) => item.providerId === chosenProviderId)?.qualification ?? null
                  }
                  quote={currentQuote}
                  loading={quote.isPending}
                  error={quote.isError ? dict.booking.quoteFailed : null}
                  onRetryQuote={() => void quote.mutate(quoteInput ?? { serviceId: service.id })}
                  onAgree={(value) => update({ agreed: value })}
                />
              ) : null}

              {step === 5 ? (
                <div>
                  <h2 className="text-xl font-semibold text-navy">{dict.booking.paymentTitle}</h2>
                  <p className="mt-1 text-sm text-secondary">{dict.booking.paymentText}</p>
                  <RadioGroup
                    value={basket.paymentMode ?? ""}
                    onValueChange={(value) => update({ paymentMode: value === "online" ? "ONLINE" : "cash" === value ? "CASH" : null })}
                    className="mt-6 grid gap-3"
                  >
                    {(
                      [
                        { value: "cash", title: dict.booking.cash, body: dict.booking.cashText },
                        { value: "online", title: dict.booking.online, body: dict.booking.onlineText },
                      ] as const
                    ).map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-[12px] border p-4 transition",
                          basket.paymentMode?.toLowerCase() === option.value ? "border-primary bg-blue-50" : "border-line hover:border-slate-300",
                        )}
                      >
                        <RadioGroupItem value={option.value} className="mt-1" />
                        <span>
                          <span className="block font-semibold text-navy">{option.title}</span>
                          <span className="mt-1 block text-sm leading-6 text-secondary">{option.body}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                  {currentQuote !== null && currentQuote.outstandingReceivablePaisa > 0 ? (
                    <p className="mt-4 rounded-[9px] border border-amber-200 bg-amber-50 p-3.5 text-sm leading-6 text-amber-900">
                      {dict.booking.outstandingWarning} · {money(currentQuote.outstandingReceivablePaisa, locale)}
                    </p>
                  ) : null}
                  {basket.paymentMode === "ONLINE" && currentQuote !== null && currentQuote.totalPaisa <= 0 ? (
                    <p className="mt-4 rounded-[9px] bg-rose-50 p-3.5 text-sm leading-6 text-rose-700">{dict.booking.nothingToPayOnline}</p>
                  ) : null}
                </div>
              ) : null}

              {localError !== "" ? <p className="mt-5 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">{localError}</p> : null}

              <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
                <Button type="button" variant="secondary" onClick={goBack} disabled={step === 0 || createBooking.isPending}>
                  <ChevronLeft className="size-4 rtl:rotate-180" />
                  {dict.common.back}
                </Button>
                <Button type="button" onClick={() => void goNext()} disabled={createBooking.isPending}>
                  {createBooking.isPending
                    ? dict.booking.creating
                    : step === STEPS - 1
                      ? dict.booking.confirm
                      : dict.common.continue}
                  <ChevronRight className="size-4 rtl:rotate-180" />
                </Button>
              </div>
              {step < STEPS - 1 && !canContinue ? (
                <p className="mt-2 text-end text-xs text-muted" aria-live="polite">{dict.booking.completeStepToContinue}</p>
              ) : null}
            </Card>

            <aside className="h-fit overflow-hidden rounded-[14px] bg-navy-950 text-white lg:sticky lg:top-24">
              <div className="p-5">
                <h2 className="font-semibold text-white">{locale === "ur" ? service.nameUr : service.nameEn}</h2>
                <p className="mt-1 text-sm leading-6 text-white/70">{service.description}</p>
                <dl className="mt-5 grid gap-3 border-t border-white/15 pt-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-white/60">{dict.booking.estimate}</dt>
                    <dd className="text-end font-medium text-white">{money(service.basePricePaisa, locale)}</dd>
                  </div>
                  {service.visitFeePaisa > 0 ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-white/60">{dict.booking.visitFee}</dt>
                      <dd className="text-end text-white/90">{money(service.visitFeePaisa, locale)}</dd>
                    </div>
                  ) : null}
                  {service.expectedDurationMin > 0 ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-white/60">{dict.booking.expectedDuration}</dt>
                      <dd className="text-end text-white/90">{dict.booking.minutesValue} {service.expectedDurationMin}</dd>
                    </div>
                  ) : null}
                </dl>
                {/* The catalogue figure is a starting point, not a total. The
                    authoritative number is the quote, shown on the review step
                    and never here, so no figure on screen contradicts another. */}
                <p className="mt-4 text-xs leading-5 text-white/60">{dict.booking.estimateIsGuide}</p>
                <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-white/60">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-yellow-500" />
                  {dict.booking.escrowNote}
                </p>
              </div>
            </aside>
          </div>
        </Container>
      </Section>
    </>
  );
}

/**
 * The problem, chosen from the list the API publishes for this service.
 *
 * `GET /catalogue/services/:slug/issue-options` exists precisely so a customer
 * who cannot describe a fault in technical terms does not have to try: the old
 * version of this step was a free-text box and a minimum character count, which
 * made the platform's own vocabulary optional and the customer's phrasing
 * mandatory. Picking an option sends `issueOptionId`, which the server validates
 * against the service, so a booking records a machine-readable fault as well as
 * the words.
 *
 * The options are the API's, never a local list: a hardcoded fault the catalogue
 * does not sell would send an id the server rejects at checkout, and an invented
 * one the service does not define is a promise nobody can keep. A service with
 * no published faults says so and falls back to the description alone.
 */
function ProblemStep({
  locale,
  dict,
  serviceSlug,
  issueOptionId,
  notes,
  onSelect,
  onNotes,
}: {
  locale: Locale;
  dict: Dictionary;
  serviceSlug: string;
  issueOptionId: number | null;
  notes: string;
  onSelect: (issueOptionId: number | null) => void;
  onNotes: (value: string) => void;
}) {
  const options = useIssueOptions(serviceSlug, locale);
  const list = options.data?.items ?? [];
  const failed = options.isError;

  const optionList = [
    { value: "", label: dict.booking.issueChoose },
    ...list.map((option) => ({ value: String(option.id), label: locale === "ur" ? option.labelUr : option.labelEn })),
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-navy">{dict.booking.detailsTitle}</h2>
      <p className="mt-1 text-sm text-secondary">{dict.booking.detailsText}</p>

      <div className="mt-6 grid gap-2">
        <Label htmlFor="booking-issue">{dict.booking.issueLabel}</Label>
        {failed ? (
          /* The fault list is the required answer here, so a failure to load it
             has to be visible and retryable rather than falling through to a text
             box that silently books something the API never offered. */
          <div role="alert" className="rounded-[9px] bg-rose-50 p-3.5 text-sm text-rose-700">
            {dict.booking.issueLoadFailed}
            <Button type="button" variant="secondary" size="sm" className="ms-3" onClick={() => void options.refetch()}>
              {dict.catalogue.retry}
            </Button>
          </div>
        ) : options.isPending ? (
          <p className="text-sm text-secondary" aria-busy="true">
            {dict.booking.issueLoading}
          </p>
        ) : list.length === 0 ? (
          /* A service the administrator published no faults for. The description is
             then the only answer, and the step says which one is required. */
          <p className="rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">
            {dict.booking.issueNone}
          </p>
        ) : (
          <SelectField
            id="booking-issue"
            value={issueOptionId === null ? "" : String(issueOptionId)}
            onChange={(value) => onSelect(value === "" ? null : Number(value))}
            options={optionList}
            placeholder={dict.booking.issueChoose}
          />
        )}
        <p className="text-xs text-muted">{dict.booking.issueHint}</p>
      </div>

      <div className="mt-5 grid gap-2">
        <Label htmlFor="booking-problem">{dict.booking.problemLabel}</Label>
        <Textarea
          id="booking-problem"
          className="min-h-28"
          value={notes}
          onChange={(event) => onNotes(event.target.value)}
          placeholder={dict.booking.problemPlaceholder}
        />
        <p className="text-xs text-muted">{dict.booking.problemHint}</p>
      </div>

      <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.booking.photosAfterBooking}</p>
    </div>
  );
}

function ScheduleStep({
  locale,
  dict,
  service,
  autoAssign,
  selectedDate,
  days,
  selected,
  slotTaken,
  slotError,
  onRetrySlots,
  onDateChange,
  onSlot,
  onRequest,
  emergencyAllowed,
  emergency,
  onEmergency,
  emergencyLabel,
  emergencyNote,
  slotTimes,
  slotsLoading,
  slotsEmpty,
}: {
  locale: Locale;
  dict: Dictionary;
  service: CatalogueService;
  autoAssign: boolean;
  selectedDate: string;
  days: { value: string; label: string }[];
  selected: ScheduleRequest | { start: string; end: string } | null;
  slotTaken: boolean;
  slotError: string | null;
  onRetrySlots: () => void;
  onDateChange: (date: string) => void;
  onSlot: (slot: { start: string; end: string }) => void;
  onRequest: (request: ScheduleRequest) => void;
  emergencyAllowed: boolean;
  emergency: boolean;
  onEmergency: (value: boolean) => void;
  emergencyLabel: string;
  emergencyNote: string;
  slotTimes: { start: string; end: string }[];
  slotsLoading: boolean;
  slotsEmpty: boolean;
}) {
  const tag = locale === "ur" ? "ur-PK" : "en-PK";
  const asRequest = selected !== null && "date" in selected ? selected : null;

  return (
    <div>
      <h2 className="text-xl font-semibold text-navy">{dict.booking.scheduleTitle}</h2>
      <p className="mt-1 text-sm text-secondary">{autoAssign ? dict.booking.scheduleTextAuto : dict.booking.scheduleText}</p>

      <div className="mt-6 grid gap-5">
        <DayPicker dict={dict} days={days} selected={selectedDate} onSelect={onDateChange} />

        {autoAssign ? (
          <RequestedWindowPicker
            locale={locale}
            dict={dict}
            date={selectedDate}
            durationMin={Math.max(30, service.expectedDurationMin)}
            selected={asRequest}
            onSelect={onRequest}
          />
        ) : (
          <div className="grid gap-2">
            {slotsLoading ? (
              <p className="text-sm text-secondary" aria-busy="true">{dict.booking.slotsLoading}</p>
            ) : slotError !== null ? (
              <div role="alert" className="rounded-[9px] bg-rose-50 p-3.5 text-sm text-rose-700">
                {slotError}
                <Button type="button" variant="secondary" size="sm" className="ms-3" onClick={onRetrySlots}>
                  {dict.catalogue.retry}
                </Button>
              </div>
            ) : slotsEmpty ? (
              <p className="rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.booking.slotsNone}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {slotTimes.map((slot) => {
                    const active = selected !== null && "start" in selected && selected.start === slot.start;
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => onSlot(slot)}
                        aria-pressed={active}
                        className={cn(
                          "min-h-11 whitespace-nowrap rounded-[9px] border px-3 text-sm font-semibold tabular-nums transition-colors duration-200",
                          active ? "border-primary bg-blue-50 text-primary-strong" : "border-line bg-white text-navy hover:bg-slate-50",
                        )}
                      >
                        {formatSlotTime(slot.start, tag)}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs leading-5 text-muted">{dict.booking.slotsAreNotHeld}</p>
              </>
            )}
            {slotTaken ? (
              <p role="alert" className="rounded-[9px] border border-amber-200 bg-amber-50 p-3.5 text-sm leading-6 text-amber-900">
                {dict.booking.slotTaken}
              </p>
            ) : null}
          </div>
        )}

        {/* FR-CAT-06: the surcharge only appears on an emergency-eligible
            service, and the amount itself comes from the quote. */}
        {emergencyAllowed ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-line p-3.5 text-sm">
            <input type="checkbox" checked={emergency} onChange={(event) => onEmergency(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span>
              <span className="flex items-center gap-1.5 block font-semibold text-navy">
                <Zap className="size-3.5 text-amber-500" aria-hidden="true" />
                {emergencyLabel}
              </span>
              <span className="mt-0.5 block text-secondary">{emergencyNote}</span>
            </span>
          </label>
        ) : null}
      </div>
    </div>
  );
}

function ReviewStep({
  locale,
  dict,
  service,
  basket,
  chosenProviderName,
  quote,
  loading,
  error,
  onRetryQuote,
  onAgree,
}: {
  locale: Locale;
  dict: Dictionary;
  service: CatalogueService;
  basket: Basket;
  chosenProviderName: string | null;
  quote: Quote | null;
  loading: boolean;
  error: string | null;
  onRetryQuote: () => void;
  onAgree: (value: boolean) => void;
}) {
  const autoAssign = isAutoAssign(basket.choice);
  const scheduled = basket.slot ?? basket.request;
  /* The fault's own words, not its id. Reading it back off the options query is
     what keeps the review honest: an id would be a number the customer cannot
     check, and a locally retyped label would be a second source of truth. */
  const issues = useIssueOptions(service.slug, locale);
  const issueLabel = basket.issueOptionId === null ? null : (issues.data?.items.find((option) => option.id === basket.issueOptionId) ?? null);

  return (
    <div>
      <h2 className="text-xl font-semibold text-navy">{dict.booking.reviewTitle}</h2>
      <p className="mt-1 text-sm text-secondary">{dict.booking.reviewText}</p>

      <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted">{dict.common.service}</dt>
          <dd className="text-end font-medium text-navy">{locale === "ur" ? service.nameUr : service.nameEn}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted">{dict.booking.professional}</dt>
          <dd className="text-end font-medium text-navy">
            {autoAssign ? dict.booking.autoAssignChosen : (chosenProviderName ?? dict.booking.selectedProfessional)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted">{dict.booking.slot}</dt>
          <dd className="text-end font-medium text-navy tabular-nums">
            {describeSchedule(scheduled, locale)}
          </dd>
        </div>
        {issueLabel !== null ? (
          <div className="flex flex-col gap-1 py-3">
            <dt className="text-muted">{dict.booking.issueLabel}</dt>
            <dd className="text-end text-secondary">{locale === "ur" ? issueLabel.labelUr : issueLabel.labelEn}</dd>
          </div>
        ) : null}
        {basket.problem.trim() !== "" ? (
          <div className="flex flex-col gap-1 py-3">
            <dt className="text-muted">{dict.booking.problemLabel}</dt>
            <dd className="text-end text-secondary">{basket.problem.trim()}</dd>
          </div>
        ) : null}
      </dl>

      {/* FR-BK-04: the itemised price, any outstanding receivable and the
          cancellation policy all render before confirm is allowed. Every figure
          is the server's, from POST /bookings/quote. */}
      <div className="mt-5 rounded-[12px] border border-line bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">{dict.booking.costBreakdown}</p>
        {loading ? (
          <p className="mt-3 text-sm text-secondary" aria-busy="true">{dict.booking.pricingBooking}</p>
        ) : error !== null ? (
          <div role="alert" className="mt-3 text-sm text-rose-700">
            {error}
            <Button type="button" variant="secondary" size="sm" className="ms-3" onClick={onRetryQuote}>
              {dict.catalogue.retry}
            </Button>
          </div>
        ) : quote === null ? (
          <p className="mt-3 text-sm text-secondary">{dict.booking.quoteFailed}</p>
        ) : (
          <>
            <dl className="mt-3 grid gap-2 text-sm">
              {quote.lines.map((line, index) => (
                <div key={`${line.kind}-${index}`} className="flex justify-between gap-4">
                  <dt className={cn("text-secondary", line.kind === "DISCOUNT" && "text-emerald-700")}>{line.description}</dt>
                  <dd className={cn("text-navy tabular-nums", line.kind === "DISCOUNT" && "text-emerald-700")}>{money(line.amountPaisa, locale)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-line pt-2.5">
                <dt className="font-semibold text-navy">{dict.booking.total}</dt>
                <dd className="text-lg font-semibold text-navy tabular-nums">{money(quote.totalPaisa, locale)}</dd>
              </div>
              {/* FR-PY-11: collected separately from the booking total, and the
                  API is explicit that it is not part of it. */}
              {quote.outstandingReceivablePaisa > 0 ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-rose-700">{dict.booking.outstandingFees}</dt>
                  <dd className="font-medium text-rose-700 tabular-nums">{money(quote.outstandingReceivablePaisa, locale)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 border-t border-line pt-2.5">
                <dt className="font-semibold text-navy">{dict.booking.payable}</dt>
                <dd className="font-semibold text-navy tabular-nums">{money(quote.payablePaisa, locale)}</dd>
              </div>
            </dl>
            <div className="mt-4 flex items-start gap-2.5 rounded-[9px] border border-amber-200 bg-amber-50 p-3.5 text-sm leading-6 text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {/* Server-rendered from the platform's own settings, so it cannot
                  drift from the rules the API will actually apply. */}
              <span>{quote.cancellationPolicy}</span>
            </div>
          </>
        )}
      </div>

      <label className="mt-5 flex items-start gap-3 text-sm text-secondary">
        <Checkbox checked={basket.agreed} onCheckedChange={(value) => onAgree(value === true)} className="mt-0.5" />
        {dict.booking.agreeTerms}
      </label>
    </div>
  );
}

function BookingConfirmed({
  locale,
  dict,
  service,
  booking,
}: {
  locale: Locale;
  dict: Dictionary;
  service: CatalogueService;
  booking: CreatedBooking;
}) {
  /* An ONLINE booking is PENDING_PAYMENT until the gateway's signed webhook
     confirms capture, so it is not yet a request. Saying "your booking is in"
     here would be a claim the platform cannot make yet. */
  const awaitingPayment = booking.payment !== undefined || booking.status === "PENDING_PAYMENT";
  const tag = locale === "ur" ? "ur-PK" : "en-PK";

  return (
    <>
      <PageBanner
        eyebrow={dict.booking.reference}
        title={awaitingPayment ? dict.booking.awaitingPaymentTitle : dict.booking.successTitle}
        titleAccent={booking.code}
      />
      <Section tone="surface" size="default">
        <Container>
          <Card className="mx-auto max-w-2xl p-8">
            <div className="text-center">
              <span className={cn("mx-auto grid size-14 place-items-center rounded-full", awaitingPayment ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>
                {awaitingPayment ? <CalendarDays className="size-7" /> : <CheckCircle2 className="size-7" />}
              </span>
              <p className="mt-5 text-sm leading-6 text-secondary">
                {awaitingPayment ? dict.booking.awaitingPaymentText : dict.booking.successText}
              </p>
            </div>

            <dl className="mt-6 grid gap-3 rounded-[10px] bg-slate-50 p-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">{dict.common.service}</dt>
                <dd className="mt-0.5 font-medium text-navy">{locale === "ur" ? service.nameUr : service.nameEn}</dd>
              </div>
              <div>
                <dt className="text-muted">{dict.booking.professional}</dt>
                <dd className="mt-0.5 font-medium text-navy">
                  {isAwaitingProvider(booking) ? dict.booking.awaitingAssignment : dict.booking.assignedProfessional}
                </dd>
              </div>
              <div>
                <dt className="text-muted">{dict.booking.slot}</dt>
                <dd className="mt-0.5 font-medium text-navy tabular-nums">
                  {new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" }).format(
                    new Date(booking.scheduledStart),
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted">{dict.booking.total}</dt>
                <dd className="mt-0.5 font-semibold text-navy tabular-nums">{money(booking.quotedAmountPaisa, locale)}</dd>
              </div>
              <div>
                <dt className="text-muted">{dict.booking.paymentMode}</dt>
                <dd className="mt-0.5 font-medium text-navy">{booking.paymentMode === "ONLINE" ? dict.booking.online : dict.booking.cash}</dd>
              </div>
              <div>
                <dt className="text-muted">{dict.common.status}</dt>
                <dd className="mt-0.5 font-medium text-navy">
                  {awaitingPayment ? dict.booking.statusAwaitingPayment : dict.booking.statusRequested}
                </dd>
              </div>
            </dl>

            {isHeldPayment(booking) ? (
              <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.booking.heldNote}</p>
            ) : null}

            {booking.payment !== undefined ? (
              <div className="mt-6">
                <a
                  /* Same-origin: the gateway URL is the mock provider's own page
                     behind the same rewrite, so the httpOnly refresh cookie
                     still applies on the way back. */
                  href={booking.payment.redirectUrl}
                  className={buttonStyles({ className: "w-full" })}
                >
                  {dict.booking.payNow}
                </a>
                <p className="mt-2 text-xs leading-5 text-muted">{dict.booking.payNowNote}</p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <ButtonLink href={localizedPath(locale, `/account/bookings/${booking.id}`)}>{dict.booking.viewBooking}</ButtonLink>
              <ButtonLink href={localizedPath(locale, "/account/bookings")} variant="secondary">
                {dict.portal.bookings}
              </ButtonLink>
            </div>
          </Card>
        </Container>
      </Section>
    </>
  );
}

/* The API's own `detail` is the only account of *why* a booking was refused, and
   it names a rule the customer can act on ("must start in the future", "provider
   has recorded leave"). It is shown verbatim — translated or softened, it would be
   a different sentence from the one the platform will actually enforce — and then
   the reassurance, because the one thing a customer wants to know after a refusal
   is that nothing was taken. */
const createFailure = (error: unknown, dict: Dictionary): string => {
  const reason = error instanceof Error && error.message.trim() !== "" ? error.message.trim() : "";
  return reason === "" ? dict.booking.createFailed : `${reason} ${dict.booking.createFailed}`;
};

const isSlotTaken = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "SLOT_TAKEN";

/**
 * The schedule line on the review step, in Asia/Karachi.
 *
 * A requested window names its day and its start; a real slot does not carry a
 * day of its own, because `/slots` was asked for one and returns instants inside
 * it. Formatting in the browser's zone would show the wrong day to anybody
 * outside Pakistan — midnight local is 19:00Z the previous day.
 */
function describeSchedule(scheduled: ScheduleRequest | { start: string; end: string } | null, locale: Locale): string {
  if (scheduled === null) return locale === "ur" ? "منتخب نہیں" : "Not chosen yet";
  const tag = locale === "ur" ? "ur-PK" : "en-PK";
  if ("date" in scheduled) return `${formatDay(scheduled.date, locale)}, ${formatSlotTime(scheduled.start, tag)}`;
  return new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Karachi" }).format(
    new Date(scheduled.start),
  );
}