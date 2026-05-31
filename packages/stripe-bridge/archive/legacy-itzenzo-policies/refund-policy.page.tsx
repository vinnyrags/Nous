import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteSettings } from "@/lib/settings";
import { getPages, getPage } from "@/lib/pages";
import PageHero from "@/components/PageHero";
import PageSections from "@/components/PageSections";
import SectionNav from "@/components/SectionNav";
import { slugify } from "@/lib/slugify";

export async function generateMetadata(): Promise<Metadata> {
  const [settings, pages] = await Promise.all([getSiteSettings(), getPages()]);
  const page = getPage(pages, "how-it-works-refund-policy");

  return {
    title: `Refund Policy — ${settings.itzenzoSiteTitle}`,
    description: page?.heroSubtitle || settings.itzenzoSiteDescription,
  };
}

export default async function HowItWorksRefundPolicy() {
  const [, pages] = await Promise.all([getSiteSettings(), getPages()]);
  const page = getPage(pages, "how-it-works-refund-policy");

  if (!page) notFound();

  return (
    <>
      <PageHero
        title={page.heroTitle}
        subtitle={page.heroSubtitle}
        squiggleVariant={3}
      />

      <PageSections sections={page.sections} heroVariant={3} />

      <SectionNav
        items={page.sections.map((s) => ({
          id: slugify(s.title),
          label: s.title,
        }))}
      />
    </>
  );
}
