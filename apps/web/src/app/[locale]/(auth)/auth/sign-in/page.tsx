import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SignInForm } from "@/features/auth/sign-in-form";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  return { title: dict.auth.signIn, description: dict.auth.signInText };
}

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  /* The form reads the locale's own dictionary and ?returnTo, so it is a client
     component and cannot be prerendered with a searchParams-dependent title. */
  return <SignInForm locale={locale} dict={getDictionary(locale)} />;
}