import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteSettings } from "@/lib/settings";
import { getPages, getPage } from "@/lib/pages";
import PageHero from "@/components/PageHero";
import PageSections from "@/components/PageSections";
import SectionNav from "@/components/SectionNav";
import ShippingPaymentCallout from "@/components/ShippingPaymentCallout";
import Container from "@/components/layout/Container";
import { slugify } from "@/lib/slugify";

export async function generateMetadata(): Promise<Metadata> {
  const [settings, pages] = await Promise.all([getSiteSettings(), getPages()]);
  const page = getPage(pages, "how-it-works-shipping");

  return {
    title: `Shipping & Delivery — ${settings.itzenzoSiteTitle}`,
    description: page?.heroSubtitle || settings.itzenzoSiteDescription,
  };
}

export default async function HowItWorksShipping() {
  const [settings, pages] = await Promise.all([getSiteSettings(), getPages()]);
  const page = getPage(pages, "how-it-works-shipping");

  if (!page) notFound();

  const ratesSection = {
    title: "Shipping Rates",
    content: `
      <div>
        <h3 class="font-semibold text-foreground mb-1">Domestic (US)</h3>
        <ul class="list-inside list-disc">
          <li><strong>${settings.itzenzoShippingDomesticRate}</strong> per shipping period</li>
          <li>Delivery: ${settings.itzenzoShippingDomesticDelivery}</li>
          <li>${settings.itzenzoShippingDomesticFrequency}</li>
          <li>${settings.itzenzoShippingDomesticNote}</li>
        </ul>
      </div>
      <div>
        <h3 class="font-semibold text-foreground mb-1">International</h3>
        <ul class="list-inside list-disc">
          <li><strong>${settings.itzenzoShippingIntlRate}</strong> per shipping period</li>
          <li>Delivery: ${settings.itzenzoShippingIntlDelivery}</li>
          <li>${settings.itzenzoShippingIntlFrequency}</li>
          <li>${settings.itzenzoShippingIntlNote}</li>
          <li>${settings.itzenzoShippingIntlCountries}</li>
        </ul>
      </div>
    `,
  };

  // Insert "Shipping Rates" section right before "Why Flat-Rate Shipping?"
  // (so the user sees rates → reasoning → schedule). Drop sections that
  // came back from WP without a title — those are ACF repeater rows
  // mid-edit and would otherwise render as a hollow heading-less block
  // (and used to crash the entire static export when slugify hit null).
  const cleanSections = page.sections.filter((s) => !!s.title);
  const insertIndex = cleanSections.findIndex((s) =>
    s.title.toLowerCase().includes("flat-rate"),
  );
  const allSections =
    insertIndex >= 0
      ? [
          ...cleanSections.slice(0, insertIndex),
          ratesSection,
          ...cleanSections.slice(insertIndex),
        ]
      : [...cleanSections, ratesSection];

  return (
    <>
      <PageHero
        title={page.heroTitle}
        subtitle={page.heroSubtitle}
        squiggleVariant={3}
      />

      <Container as="section" className="py-[clamp(1.5rem,4vw,3rem)]">
        <ShippingPaymentCallout />
      </Container>

      <PageSections sections={allSections} heroVariant={3} />

      <SectionNav
        items={allSections.map((s) => ({
          id: slugify(s.title),
          label: s.title,
        }))}
      />
    </>
  );
}
