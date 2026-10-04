import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TotpForm } from "@/features/auth/totp-form";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  return { title: dict.auth.totpTitle, description: dict.auth.totpIntro };
}

export default async function TotpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <TotpForm locale={locale} dict={getDictionary(locale)} />;
}