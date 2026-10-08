import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RegisterForm } from "@/features/auth/register-form";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  return { title: dict.auth.register, description: dict.auth.registerText };
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <RegisterForm locale={locale} dict={getDictionary(locale)} />;
}