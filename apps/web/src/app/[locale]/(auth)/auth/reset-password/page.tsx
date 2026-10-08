import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  return { title: dict.auth.resetTitle, description: dict.auth.resetAccent };
}

export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  /* The account the code was requested for arrives on the query string. The
     code itself never does: it is the secret, and it is posted. */
  return <ResetPasswordForm locale={locale} dict={getDictionary(locale)} />;
}