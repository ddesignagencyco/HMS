import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ForgotForm } from "@/features/auth/forgot-form";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  return { title: dict.auth.forgot, description: dict.auth.forgotText };
}

export default async function ForgotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ForgotForm locale={locale} dict={getDictionary(locale)} />;
}