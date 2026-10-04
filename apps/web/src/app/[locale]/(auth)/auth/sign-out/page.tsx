import { notFound } from "next/navigation";
import { signOutAction } from "@/features/auth/auth-actions";
import { isLocale } from "@/lib/utils";

/* Sign-out is a route so it works from a plain link, a redirect, or a plain
   <form> — anything that cannot post a server action. */
export default async function SignOutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await signOutAction(new FormData());
}
