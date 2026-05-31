import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Container from "@/components/layout/Container";
import { TERMS_VERSION, TERMS_LAST_UPDATED } from "@/lib/terms";

/**
 * Terms of Service + Refund Policy — itzenzo.tv
 *
 * Hardcoded (not CMS-driven) on purpose. Legal documents need git
 * history, version tags, and review on every change — exactly what
 * a casual WP-admin edit would bypass. The buyer-friendly summary
 * at /how-it-works/refund-policy stays CMS-driven for the operator-
 * editable everyday explanation; this page is the authoritative
 * record that gets shown at checkout for acknowledgement.
 *
 * Update protocol: bump TERMS_VERSION + TERMS_LAST_UPDATED in
 * src/lib/terms.ts on every meaningful change. The checkout flows
 * read the same constants so the checkbox label always surfaces the
 * current version — old acceptances stay tied to the version they
 * actually saw.
 */

const OPERATOR_LEGAL_NAME = "Vincent Ragosta Inc (d/b/a itzenzoTTV)";
const GOVERNING_STATE = "New York";

export const metadata: Metadata = {
  title: "Terms of Service & Refund Policy — itzenzo.tv",
  description:
    "The terms you agree to when you buy from itzenzo.tv — what we sell, how shipping works, when refunds apply, and the rules of pack openings during our live broadcasts.",
};

// Inline shared classes — applied directly on each element, mirroring
// how PageSections.tsx + other info pages style their section titles
// and content. Kept here so updates land in one place without pulling
// in a wrapper component (the page is structurally flat enough that a
// component would obscure more than it would DRY up).
const H2 = "text-3xl font-semibold text-foreground mb-3";
const BODY = "space-y-3 leading-relaxed text-muted";
const UL = "list-disc space-y-1 pl-6";

export default function LegalTerms() {
  return (
    <>
      <PageHero
        title="Terms of Service & <strong>Refund Policy</strong>"
        subtitle={`Last updated: ${TERMS_LAST_UPDATED} · Version ${TERMS_VERSION}. The terms you agree to when you buy from itzenzo.tv.`}
        squiggleVariant={4}
      />

      <Container as="section" className="py-[clamp(2rem,6vw,4rem)]">
        <article className="w-full max-w-none space-y-10">
          <p className="rounded border border-accent/40 bg-accent/5 p-4 text-sm text-muted">
            <strong className="text-foreground">Plain English first:</strong>{" "}
            this is the legal record of how buying from itzenzo.tv works. The
            everyday explanation lives on{" "}
            <Link
              href="/how-it-works/refund-policy"
              className="text-accent underline"
            >
              the refund policy summary
            </Link>{" "}
            — that page is what most buyers read. This page is what we both
            agree to at checkout.
          </p>

          <section>
            <h2 id="about" className={H2}>1. About these terms</h2>
            <div className={BODY}>
              <p>
                itzenzo.tv (&quot;the shop,&quot; &quot;we,&quot;
                &quot;I,&quot; &quot;operator&quot;) is operated by{" "}
                {OPERATOR_LEGAL_NAME}. These terms govern every purchase made
                at itzenzo.tv and any communication that leads to a purchase
                (the Discord card-shop, live-broadcast Buy Now buttons,
                and the Make an Offer flow on the personal collection
                page).
              </p>
              <p>
                By completing a purchase or accepting an offer, you confirm
                that you&apos;ve read and agree to these terms in the version
                shown to you at checkout. We may update them over time —{" "}
                <a href="#changes" className="text-accent underline">Section 17</a>{" "}
                covers how that works.
              </p>
            </div>
          </section>

          <section>
            <h2 id="who" className={H2}>2. Who can use the site</h2>
            <div className={BODY}>
              <p>
                You must be at least <strong className="text-foreground">13 years old</strong>{" "}
                to use itzenzo.tv. If you&apos;re under 18 in your
                jurisdiction, you confirm that a parent or guardian agrees to
                these terms on your behalf and is responsible for any charges.
              </p>
              <p>
                The <strong className="text-foreground">After Dark</strong>{" "}
                segment (when launched) is restricted to buyers 18 and older.
                Access is gated behind the{" "}
                <strong className="text-foreground">Ena</strong> role on
                Discord, granted only after age verification.
              </p>
            </div>
          </section>

          <section>
            <h2 id="purchases" className={H2}>3. How purchases work</h2>
            <div className={BODY}>
              <p>
                All payments are processed by Stripe. We do not see or store
                your credit card information — Stripe handles the entire
                transaction end-to-end and emails you a receipt directly.
              </p>
              <p>
                No account is required. Your email address is used to
                recognize you across visits, check whether your shipping
                period is already covered, and reach you about your order.
                By submitting an email at checkout you authorize us to
                contact you about that order and any closely related
                fulfillment matter (shipping invoices, tracking, refund
                confirmations).
              </p>
            </div>
          </section>

          <section>
            <h2 id="what-you-are-buying" className={H2}>4. What you&apos;re buying</h2>
            <div className={BODY}>
              <p>The shop sells two categories of product:</p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">Sealed product</strong>{" "}
                  — booster boxes, booster packs, elite trainer boxes,
                  accessories, and other factory-sealed items. You receive
                  the exact product listed.
                </li>
                <li>
                  <strong className="text-foreground">Individual cards (singles)</strong>{" "}
                  — pulled, graded, or otherwise identified cards listed at
                  itzenzo.tv/cards. Each listing shows the card&apos;s
                  condition (NM, LP, MP, HP, DMG) in the corner of the
                  tile. The card you receive is the card you ordered, at
                  the condition shown.
                </li>
              </ul>
              <p>
                <strong className="text-foreground">
                  Pull boxes, pack battles, and individual booster packs are
                  an <em>experience</em>, not a specific item.
                </strong>{" "}
                You are paying for a buy-in to a randomized live event:
              </p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">Pull boxes</strong> —
                  a $5 ticket entitles you to whatever cards come out of the
                  corresponding slot when opened live during a live broadcast. We do not
                  guarantee any specific card, value, rarity, or set
                  distribution. The displayed chase prize is illustrative,
                  not promised.
                </li>
                <li>
                  <strong className="text-foreground">Pack battles</strong>{" "}
                  — your buy-in is for one pack in a head-to-head battle.
                  The highest-value card across all packs wins all the
                  cards. If your pack loses, you receive nothing physical.
                  The buy-in funds the event itself.
                </li>
                <li>
                  <strong className="text-foreground">
                    Individual booster packs (e.g. Astral Radiance Booster
                    Pack, Lost Origin Booster Pack)
                  </strong>{" "}
                  — the pack is opened during a live broadcast as part of the night&apos;s
                  programming. You receive whatever pulls from your pack.
                  The buy-in covers the pack at retail; we do not guarantee
                  a hit.
                </li>
              </ul>
              <p>
                All cards pulled during a live broadcast are real, authentic, and yours.
                We do not pre-screen packs or substitute cards.
              </p>
              <p>
                <strong className="text-foreground">
                  The decisive moment is the opening, not the shipping.
                </strong>{" "}
                The instant a pack is opened during a live broadcast on your behalf — your
                pull-box slot, your booster, your pack-battle entry — the
                transaction is locked in. The cards are real, they came out
                of <em>your</em> pack, and we can&apos;t put them back.
                Refunds for these items end at the moment the pack is opened,
                not at the moment the package ships.
              </p>
            </div>
          </section>

          <section>
            <h2 id="pricing" className={H2}>5. Pricing, taxes, and currency</h2>
            <div className={BODY}>
              <p>
                All prices are listed in{" "}
                <strong className="text-foreground">U.S. dollars</strong>. You
                are responsible for any sales tax, customs duties, import
                fees, or other taxes that apply in your jurisdiction. Stripe
                Checkout may calculate and collect sales tax automatically
                where required by law; international buyers should expect
                customs / duty charges on delivery, billed separately by the
                carrier.
              </p>
              <p>
                We reserve the right to correct pricing errors. If a product
                is listed at an obviously wrong price (e.g. a $200 box for
                $2), we may cancel and refund the order before shipping
                rather than fulfill at the typo&apos;d price.
              </p>
            </div>
          </section>

          <section>
            <h2 id="shipping" className={H2}>6. Shipping schedule and coverage</h2>
            <div className={BODY}>
              <p>
                We ship to the United States and Canada only at this time.
                Domestic orders ship every Monday. International (Canada)
                orders ship at the end of each calendar month.
              </p>
              <p>
                <strong className="text-foreground">
                  Shipping coverage is period-based.
                </strong>{" "}
                One shipping payment covers everything you buy in the same
                period:
              </p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">Domestic</strong> — $10
                  covers all your purchases from Monday through Sunday of
                  the same week.
                </li>
                <li>
                  <strong className="text-foreground">International</strong>{" "}
                  — $25 covers all your purchases from the 1st through the
                  last day of the same calendar month.
                </li>
              </ul>
              <p>
                The checkout flow automatically detects whether your
                shipping for the current period is already covered (using
                the email address on the order) and skips re-charging if
                so. We do not refund shipping in the event of an
                over-charge for the same period — instead the period
                extends to include the new orders.
              </p>
            </div>
          </section>

          <section>
            <h2 id="held-inventory" className={H2}>7. Held inventory and speculative items</h2>
            <div className={BODY}>
              <p>
                Pull boxes, individual booster packs, and pack-battle
                entries are billed as{" "}
                <strong className="text-foreground">speculative purchases</strong>:
                your checkout charges only the buy-in (e.g. $5 for a pull
                box slot). Shipping is{" "}
                <strong className="text-foreground">not</strong> collected at
                checkout for these items.
              </p>
              <p>
                After the live show ends, you will receive a Discord direct
                message (or, if your Discord account isn&apos;t linked to
                the email you used at checkout, a manual email outreach)
                with a Stripe shipping checkout link. The link covers
                shipping for all your speculative items from that live
                show plus any other purchases made in the same shipping
                period.
              </p>
              <p>
                <strong className="text-foreground">
                  If you do not pay the shipping invoice within four (4)
                  weeks of the live show
                </strong>{" "}
                on which your items were opened, the cards return to our
                pulling pool and may be opened again on a future live
                show. We
                do not refund the original buy-in for items returned to
                the pool — the packs were opened during a live broadcast on your behalf,
                and per Section 8 that locks the transaction in regardless
                of whether the cards ever shipped to you.
              </p>
              <p>
                You may decline shipping at any time before the 4-week
                window expires. Taking no action is treated as a decline
                after the 4-week window passes.
              </p>
            </div>
          </section>

          <section>
            <h2 id="final-sale" className={H2}>8. Final-sale items (opened during a live broadcast)</h2>
            <div className={BODY}>
              <p>
                The refund window for any item closes the moment the pack
                is opened during a live broadcast on your behalf. After opening, the
                transaction is final — regardless of whether the cards
                have shipped yet. This applies to:
              </p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">Individual booster pack purchases</strong>{" "}
                  (e.g. Pokemon Astral Radiance Booster Pack, Pokemon Lost
                  Origin Booster Pack) — opened live during a live broadcast as part of
                  the night&apos;s programming.
                </li>
                <li>
                  <strong className="text-foreground">Pull box buy-ins</strong>{" "}
                  — once the slot you claimed is opened during a live broadcast, the
                  buy-in is locked. Unopened slots can still be refunded
                  any time before they&apos;re pulled (see Section 9).
                </li>
                <li>
                  <strong className="text-foreground">Pack battle entries</strong>{" "}
                  — refundable any time before the battle starts during
                  the live broadcast (Section 9). Once the first pack is
                  opened, every
                  buy-in for that battle is locked, including yours
                  regardless of outcome.
                </li>
                <li>
                  <strong className="text-foreground">
                    Any other &quot;opened-for-you&quot; activity
                  </strong>{" "}
                  we run during a live broadcast where the operator opens sealed product
                  on your behalf. Once it&apos;s open, the result is yours
                  and the buy-in is non-refundable.
                </li>
              </ul>
              <p>
                The reasoning is simple: opening a pack is irreversible.
                The cards came out of <em>your</em> pack and we can&apos;t
                put them back. You paid for the live experience and the
                experience happened. This rule is what protects the model
                for everyone — losing pack-battle buy-ins can&apos;t be
                clawed back, or the format wouldn&apos;t work.
              </p>
            </div>
          </section>

          <section>
            <h2 id="refunds-before-ship" className={H2}>9. Refunds — items not opened during a live broadcast</h2>
            <div className={BODY}>
              <p>
                Everything you buy that we are{" "}
                <strong className="text-foreground">not</strong> physically
                opening during a live broadcast for you is fully refundable up until your
                order ships. This covers:
              </p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">Sealed product</strong>{" "}
                  you bought to keep sealed (booster boxes, ETBs,
                  lunchboxes, premium collections, accessories, sleeves,
                  playmats, etc.) — anything you intend to receive in its
                  factory-sealed state.
                </li>
                <li>
                  <strong className="text-foreground">Card singles</strong>{" "}
                  from the catalog at itzenzo.tv/cards.
                </li>
                <li>
                  <strong className="text-foreground">The English Bundle</strong>{" "}
                  (homepage $5.99 100-card mixed bundle) up until the
                  bundle ships.
                </li>
                <li>
                  <strong className="text-foreground">Accepted Make an Offer purchases</strong>{" "}
                  on personal-collection cards, up until the card ships
                  (Section 11 has more detail on the offer flow).
                </li>
                <li>
                  <strong className="text-foreground">
                    Pack battle entries before the battle starts
                  </strong>{" "}
                  and{" "}
                  <strong className="text-foreground">
                    pull box slots before the slot is pulled
                  </strong>{" "}
                  — these become locked at the moment of opening (Section
                  8), but until then they&apos;re fully refundable.
                </li>
              </ul>
              <p>
                To request a pre-ship refund, DM{" "}
                <strong className="text-foreground">@itzenzottv</strong> on
                Discord or reply to your Stripe receipt email. Either route
                reaches the operator directly. The refund runs through
                Stripe and lands back on your original payment method in
                5–10 business days. Your order is cancelled in the
                fulfillment system so the package never ships.
              </p>
            </div>
          </section>

          <section>
            <h2 id="refunds-after-ship" className={H2}>10. Refunds — after your order ships</h2>
            <div className={BODY}>
              <p>
                Once a shipping label has been purchased and a tracking
                number has been issued, the package is on its way and we
                cannot recall it. Refund eligibility after that point
                depends on what happened:
              </p>
              <p>
                <strong className="text-foreground">How to reach us.</strong>{" "}
                Throughout this section we say &quot;DM us&quot; for
                brevity, but every Section&nbsp;10 path is also
                available by replying to your Stripe receipt email or
                to any order-confirmation / shipping-confirmation email
                we&apos;ve sent you. Both channels reach the same
                inbox. You do not need a Discord account to start a
                refund conversation.
              </p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">Lost in transit</strong>{" "}
                  — if tracking stops updating or the package shows
                  delivered but you did not receive it, DM us with the
                  tracking number and we&apos;ll work it out. We will
                  either refund or replace the order at our discretion,
                  after a reasonable carrier investigation window
                  (typically 5–7 business days).
                </li>
                <li>
                  <strong className="text-foreground">Damaged in transit</strong>{" "}
                  — DM us with photos of the package and contents within
                  48 hours of delivery. We&apos;ll refund or replace
                  damaged items.
                </li>
                <li>
                  <strong className="text-foreground">Wrong item received</strong>{" "}
                  — DM us within 7 days of delivery. We&apos;ll arrange a
                  return at our cost and refund or replace once the wrong
                  item is back with us.
                </li>
                <li>
                  <strong className="text-foreground">Condition concerns on singles</strong>{" "}
                  — these are addressed before purchase via the{" "}
                  <strong className="text-foreground">Request to See</strong>{" "}
                  flow on every card listing. After-purchase partial
                  refunds for condition claims are{" "}
                  <strong className="text-foreground">not</strong> standard
                  — the live-broadcast inspection is the time to raise
                  condition questions. Anything genuinely mis-graded
                  versus what was shown will still be handled; DM us and
                  we&apos;ll work it out.
                </li>
              </ul>
              <p>
                We do not offer refunds for &quot;changed my mind&quot;
                after a package has shipped.
              </p>
            </div>
          </section>

          <section>
            <h2 id="personal-collection" className={H2}>11. Personal collection — Make an Offer</h2>
            <div className={BODY}>
              <p>
                Cards listed on the{" "}
                <Link href="/collection" className="text-accent underline">
                  personal collection page
                </Link>{" "}
                are not actively for sale. When you submit a Make an Offer
                form, you are sending a non-binding inquiry to the
                operator. Submitting an offer does not commit you or the
                operator to a sale — it opens a conversation.
              </p>
              <p>
                If an offer is accepted, you&apos;ll receive a Stripe
                checkout link via Discord DM or email for the agreed
                amount. Once you complete that checkout, the sale is
                subject to the same terms as any other card-single
                purchase: fully refundable up until the card ships
                (Section 9), and covered by the same lost / damaged /
                wrong-item protections after shipping (Section 10).
                Because these aren&apos;t opened during a live broadcast, the Section 8
                final-sale rule doesn&apos;t apply.
              </p>
            </div>
          </section>

          <section>
            <h2 id="chargebacks" className={H2}>12. Chargebacks and disputes</h2>
            <div className={BODY}>
              <p>
                If you believe you are entitled to a refund and our normal
                process (Sections 9 and 10) has not resolved it, please
                reach out before filing a chargeback. Most disputes resolve
                faster through direct conversation than through
                Stripe&apos;s dispute process.
              </p>
              <p>
                By completing checkout you acknowledge these terms,
                including the final-sale categories in Section 8 and the
                held-inventory rules in Section 7. We retain a timestamped
                record of your acceptance for every order. If a chargeback
                is filed for reasons covered by these terms (e.g. claiming
                non-receipt of cards from a pack battle you lost, or
                disputing a Make an Offer purchase you completed
                voluntarily), we will respond to Stripe&apos;s dispute
                process with that record and contest the chargeback.
              </p>
              <p>
                We reserve the right to refuse future business with anyone
                who initiates a chargeback in bad faith.
              </p>
            </div>
          </section>

          <section>
            <h2 id="privacy" className={H2}>13. Privacy and data handling</h2>
            <div className={BODY}>
              <p>We collect and retain:</p>
              <ul className={UL}>
                <li>
                  Your email address — used both for shipping-period
                  detection and for transactional notifications: Stripe
                  receipts on every purchase, order-confirmation emails
                  on Make-an-Offer and Request-to-See submissions,
                  shipping-confirmation emails when your label prints,
                  and the no-Discord shipping-payment flow. You can
                  reply to any of these to reach the operator directly.
                </li>
                <li>
                  Your shipping address (only when you complete a Stripe
                  checkout that includes shipping — Stripe collects it on
                  our behalf)
                </li>
                <li>
                  Optionally, your Discord username (if you provide it on
                  a Request to See or Make an Offer submission)
                </li>
                <li>
                  The IP address you connected from at checkout, the
                  user-agent of your browser, and a timestamp of when you
                  accepted these terms — retained on the underlying
                  Stripe PaymentIntent for chargeback defense and fraud
                  prevention
                </li>
              </ul>
              <p>
                <strong className="text-foreground">
                  About IP and user-agent collection.
                </strong>{" "}
                We collect IP address, user-agent, and acceptance
                timestamp solely for the legitimate-interest purposes of
                chargeback defense, fraud prevention, and dispute
                resolution. We do not use them for advertising,
                profiling, behavioral tracking, or sharing with third
                parties. This data is stored on the Stripe PaymentIntent
                associated with your purchase and is retained for
                Stripe&apos;s standard 7-year compliance window. To
                request deletion outside that window, DM{" "}
                <strong className="text-foreground">@itzenzottv</strong>{" "}
                on Discord or reply to any email we&apos;ve sent you
                (Stripe receipt, order confirmation, or shipping
                confirmation) — both routes reach the operator
                directly.
              </p>
              <p>
                We do not see or store your credit card, debit card, or
                bank information. All payment data is held by Stripe under
                their privacy policy and PCI-compliant systems.
              </p>
              <p>
                We do not sell, rent, or share your data with third parties
                other than the service providers required to operate the
                shop (Stripe for payments, ShippingEasy / USPS for
                fulfillment, Discord for community communication). We
                retain order records as long as required by applicable tax
                law (typically 7 years in the U.S.).
              </p>
            </div>
          </section>

          <section>
            <h2 id="ip" className={H2}>14. Intellectual property</h2>
            <div className={BODY}>
              <p>
                Pokémon, Yu-Gi-Oh!, Magic: The Gathering, anime card game
                brands, and all other trademarks shown on the site are the
                property of their respective owners. We are an independent
                retailer of authentic product purchased through standard
                wholesale and aftermarket channels. We are not affiliated
                with or endorsed by any TCG publisher.
              </p>
              <p>
                The itzenzo.tv website, the <em>itzenzoTTV</em> brand, the
                Nous bot, and all original copy on this site are the
                property of the operator and may not be copied,
                redistributed, or used for commercial purposes without
                permission.
              </p>
            </div>
          </section>

          <section>
            <h2 id="liability" className={H2}>15. Limitation of liability</h2>
            <div className={BODY}>
              <p>
                The site and all products are provided{" "}
                <strong className="text-foreground">
                  as is and without warranty
                </strong>{" "}
                of any kind, express or implied, except where required by
                applicable consumer-protection law. We do not warrant that
                the site will be uninterrupted or error-free, that any
                specific card will be pulled from any sealed product, or
                that any particular outcome will result from a pack
                battle, pull box, or live event.
              </p>
              <p>
                To the maximum extent permitted by law, the operator&apos;s
                total liability arising out of or related to any purchase
                is limited to the amount you actually paid for the
                transaction in question. We are not liable for indirect,
                incidental, consequential, or punitive damages.
              </p>
              <p>
                Nothing in these terms is intended to limit any rights you
                have under applicable consumer-protection law that cannot
                be waived by contract.
              </p>
            </div>
          </section>

          <section>
            <h2 id="governing-law" className={H2}>16. Governing law and venue</h2>
            <div className={BODY}>
              <p>
                These terms are governed by the laws of the State of{" "}
                {GOVERNING_STATE}, without regard to its conflict-of-laws
                rules. Any dispute arising out of or related to these
                terms or a purchase from itzenzo.tv shall be brought
                exclusively in the state or federal courts located in{" "}
                {GOVERNING_STATE}, and you consent to the personal
                jurisdiction of those courts.
              </p>
              <p>
                If any provision of these terms is held to be invalid or
                unenforceable, the remaining provisions remain in full
                effect.
              </p>
            </div>
          </section>

          <section>
            <h2 id="changes" className={H2}>17. Changes to these terms</h2>
            <div className={BODY}>
              <p>
                We may update these terms from time to time. The active
                version is always displayed at the top of this page
                (currently{" "}
                <strong className="text-foreground">
                  Version {TERMS_VERSION}
                </strong>
                , last updated{" "}
                <strong className="text-foreground">
                  {TERMS_LAST_UPDATED}
                </strong>
                ).
              </p>
              <p>
                At checkout, the version number is shown next to the
                acceptance checkbox so you know exactly which version you
                are agreeing to. Acceptance of one version does not bind
                you to future versions — every new purchase requires a
                fresh acceptance of the version then in effect.
              </p>
            </div>
          </section>

          <section>
            <h2 id="contact" className={H2}>18. Contact</h2>
            <div className={BODY}>
              <p>The fastest ways to reach the operator:</p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">Discord</strong> — DM{" "}
                  <strong className="text-foreground">@itzenzottv</strong>
                </li>
                <li>
                  <strong className="text-foreground">Email</strong> — reply
                  to your Stripe receipt email; both routes land in the
                  same inbox
                </li>
              </ul>
            </div>
          </section>
        </article>
      </Container>
    </>
  );
}
