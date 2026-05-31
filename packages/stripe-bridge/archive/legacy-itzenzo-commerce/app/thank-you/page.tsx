import Link from "next/link";
import { getPages, getPage } from "@/lib/pages";
import CatalogTeaser from "@/components/CatalogTeaser";
import ThankYouClient from "./ThankYouClient";
import { getCheckoutSource } from "./actions";

interface ThankYouProps {
  searchParams: Promise<{ session_id?: string }>;
}

const SPECULATIVE_SOURCES = new Set(["speculative", "pull_box", "pack_battle"]);

export default async function ThankYou({ searchParams }: ThankYouProps) {
  const params = await searchParams;
  const sessionId = params.session_id || null;

  const [pages, source] = await Promise.all([
    getPages(),
    sessionId ? getCheckoutSource(sessionId) : Promise.resolve("committed" as const),
  ]);
  const page = getPage(pages, "thank-you");

  const isSpeculative = SPECULATIVE_SOURCES.has(source);

  const heroTitle = page?.heroTitle || "Thank you for your order!";
  const heroSubtitle =
    page?.heroSubtitle ||
    "Your payment has been processed. You'll receive a confirmation via email and a DM in Discord with your tracking number when your order ships.";

  return (
    <>
      <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
        <ThankYouClient sessionId={sessionId} />
        <h1
          className="mb-4 text-3xl font-bold [&_strong]:font-sans [&_strong]:font-bold"
          dangerouslySetInnerHTML={{ __html: heroTitle }}
        />
        <p
          className="mb-8 text-zinc-600 dark:text-zinc-400"
          dangerouslySetInnerHTML={{ __html: heroSubtitle }}
        />

        {isSpeculative && (
          <div className="mb-8 w-full rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-left text-sm text-zinc-700 dark:text-zinc-300">
            <p className="mb-2 font-semibold text-amber-700 dark:text-amber-300">
              Shipping hasn&apos;t been charged yet.
            </p>
            <p className="mb-2">
              Your purchase is for an item we open during our live show
              (pulls, packs). The card stays with us until you add shipping
              coverage.
            </p>
            <p className="mb-2">
              <strong>At the end of the live show</strong>, if your Discord
              account is linked, you&apos;ll receive a DM with a shipping
              checkout link. Complete the checkout to have your card shipped.
              Take no action to leave it in our inventory — we hold cards for{" "}
              <strong>4 weeks</strong> before returning them to our pulling
              pool.
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              See the full{" "}
              <Link
                href="/how-it-works/shipping"
                className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                shipping policy
              </Link>{" "}
              for details.
            </p>
          </div>
        )}

        <Link
          href="/"
          className="rounded bg-zinc-900 px-6 py-3 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Continue Shopping
        </Link>
        <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-500">
          Need to make a change to this order?{" "}
          <Link
            href="/how-it-works/refund-policy"
            className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            See our refund policy
          </Link>
          .
        </p>
      </div>

      <CatalogTeaser
        heading="While you wait — see what's on the singles wall"
        intro="Fresh adds from the catalog. Add to cart to bundle with this order (same shipping window), or hit Request to See to feature one on the next card night."
      />
    </>
  );
}
