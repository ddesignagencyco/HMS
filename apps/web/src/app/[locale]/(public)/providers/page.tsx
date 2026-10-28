import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProvidersSearch } from "@/features/discovery/providers-search";
import { Container, PageBanner } from "@/components/ui";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  return { title: dict.search.eyebrow, description: dict.search.intro };
}

/** Every filter lives in the query string, so this page must read it at
    request time rather than be baked into a build. */
export const dynamic = "force-dynamic";

export default async function ProvidersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      <PageBanner eyebrow={dict.search.eyebrow} title={dict.search.title} description={dict.search.intro} />
      <section className="bg-page py-10 sm:py-14">
        <Container>
          <ProvidersSearch locale={locale} dict={dict} />
        </Container>
      </section>
    </>
  );
}