import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogueExplorer } from "@/features/discovery/catalogue-explorer";
import { Container, PageBanner } from "@/components/ui";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  return { title: dict.catalogue.breadcrumbServices, description: dict.catalogue.intro };
}

/** Categories and their services, from the catalogue API. The `?category=` param
    is the project's existing convention for opening a category, so no new route
    was introduced. The page is dynamic because the catalogue is server data
    that must be current, not baked into a build. */
export const dynamic = "force-dynamic";

export default async function ServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { category = "" } = await searchParams;
  const dict = getDictionary(locale);

  return (
    <>
      <PageBanner eyebrow={dict.catalogue.eyebrow} title={dict.catalogue.title} description={dict.catalogue.intro} />
      <section className="bg-page py-10 sm:py-14">
        <Container>
          <CatalogueExplorer locale={locale} dict={dict} initialCategory={category} />
        </Container>
      </section>
    </>
  );
}