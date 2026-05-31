import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Container from "@/components/layout/Container";
import { PRIVACY_VERSION, PRIVACY_LAST_UPDATED } from "@/lib/privacy";

/**
 * Privacy Policy — itzenzo.tv
 *
 * Hardcoded (not CMS-driven) on purpose. Privacy disclosures need git
 * history, version tags, and review on every change.
 *
 * Update protocol: bump PRIVACY_VERSION + PRIVACY_LAST_UPDATED in
 * src/lib/privacy.ts on every meaningful change.
 */

const OPERATOR_LEGAL_NAME = "Vincent Ragosta Inc (d/b/a itzenzoTTV)";
const CONTACT_EMAIL = "itzenzottv@gmail.com";

export const metadata: Metadata = {
  title: "Privacy Policy — itzenzo.tv",
  description:
    "How itzenzoTTV collects, uses, stores, and shares your personal data — and the rights you have over it.",
};

const H2 = "text-3xl font-semibold text-foreground mb-3";
const BODY = "space-y-3 leading-relaxed text-muted";
const UL = "list-disc space-y-1 pl-6";

export default function LegalPrivacy() {
  return (
    <>
      <PageHero
        title="Privacy <strong>Policy</strong>"
        subtitle={`Last updated: ${PRIVACY_LAST_UPDATED} · Version ${PRIVACY_VERSION}. How itzenzoTTV handles your personal data.`}
        squiggleVariant={4}
      />

      <Container as="section" className="py-[clamp(2rem,6vw,4rem)]">
        <article className="w-full max-w-none space-y-10">
          <p className="rounded border border-accent/40 bg-accent/5 p-4 text-sm text-muted">
            <strong className="text-foreground">Plain English first:</strong>{" "}
            we collect only what we need to ship your order, answer your
            questions, and keep tax records. We never sell your data, never
            send it overseas, and never use it for marketing profiling. If
            you want to know what we have on you or want it deleted, email
            us — see Section 7 below.
          </p>

          <section>
            <h2 id="about" className={H2}>1. About this policy</h2>
            <div className={BODY}>
              <p>
                itzenzo.tv (&quot;the shop,&quot; &quot;we,&quot;
                &quot;I,&quot; &quot;operator&quot;) is operated by{" "}
                {OPERATOR_LEGAL_NAME}, a New York S Corporation
                headquartered in Brooklyn, NY. This policy describes how we
                collect, use, store, share, and protect personal data when
                you visit itzenzo.tv, place an order, contact us through
                Discord or email, or otherwise interact with the business.
              </p>
              <p>
                By using itzenzo.tv or completing a purchase, you agree to
                the data practices described in this policy. If you don&apos;t
                agree, please don&apos;t use the site or place an order — and
                if you have questions, reach out via the contact path in
                Section 11.
              </p>
            </div>
          </section>

          <section>
            <h2 id="what-we-collect" className={H2}>
              2. What personal data we collect
            </h2>
            <div className={BODY}>
              <p>We collect only the data needed to operate the business:</p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">
                    Order and contact information
                  </strong>{" "}
                  — name, email address, shipping address, phone number (if
                  you provide it), and the items you purchased. This is the
                  minimum needed to take payment, ship your order, and answer
                  questions about it.
                </li>
                <li>
                  <strong className="text-foreground">
                    Discord identifiers
                  </strong>{" "}
                  — if you link your Discord account or interact with the
                  itzenzoTTV Discord server during a purchase, we record your
                  Discord username and user ID so we can associate Discord
                  messages with your orders (queue position notifications,
                  pack-opening alerts, tracking DMs).
                </li>
                <li>
                  <strong className="text-foreground">
                    Payment information (handled by Stripe, not us)
                  </strong>{" "}
                  — card numbers, billing addresses, and transaction details
                  are collected, processed, and stored by Stripe (a PCI-DSS
                  Level 1 service provider). We never see, store, or have
                  access to your payment card data — only Stripe-issued
                  references like a charge ID.
                </li>
                <li>
                  <strong className="text-foreground">
                    Browser and server logs
                  </strong>{" "}
                  — standard server access logs (IP address, user agent,
                  timestamp, requested URL, response code) are retained for
                  30 days for security monitoring and debugging. These
                  logs are not used for marketing or behavioral profiling.
                </li>
                <li>
                  <strong className="text-foreground">
                    Cookies and similar technologies
                  </strong>{" "}
                  — see Section 8.
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 id="how-we-use" className={H2}>
              3. How we use your data
            </h2>
            <div className={BODY}>
              <p>Your personal data is used only for:</p>
              <ul className={UL}>
                <li>
                  Processing and fulfilling your orders (taking payment,
                  shipping product, sending tracking)
                </li>
                <li>
                  Sending you order-related communications (confirmations,
                  shipping notifications, tracking updates) by email and, if
                  you&apos;ve linked Discord, by Discord DM
                </li>
                <li>
                  Responding to your questions and providing customer support
                </li>
                <li>
                  Operating queue and livestream features so your purchases
                  are reflected in real-time activity feeds and on-stream
                  pack openings
                </li>
                <li>
                  Maintaining records required by US tax law and applicable
                  regulations (typically 7 years for order records)
                </li>
                <li>
                  Detecting and preventing fraud, abuse, and security
                  threats against the shop and its buyers
                </li>
              </ul>
              <p>
                <strong className="text-foreground">What we don&apos;t do:</strong>{" "}
                we don&apos;t use your data for marketing profiling, we
                don&apos;t share it with advertising networks, we don&apos;t
                use third-party tracking pixels, and we don&apos;t sell it to
                anyone. Ever.
              </p>
            </div>
          </section>

          <section>
            <h2 id="sharing" className={H2}>
              4. Who we share your data with
            </h2>
            <div className={BODY}>
              <p>
                We share your personal data only with third parties strictly
                necessary to operate the shop, or as required by law. These
                are:
              </p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">Stripe</strong> —
                  payment processing. PCI-DSS Level 1 certified. Stripe
                  receives the card data and billing information you enter
                  at checkout.
                </li>
                <li>
                  <strong className="text-foreground">
                    USPS, UPS, and other shipping carriers
                  </strong>{" "}
                  — your name and shipping address are shared with the
                  carrier responsible for delivering your order.
                </li>
                <li>
                  <strong className="text-foreground">
                    DigitalOcean, Cloudflare, GitHub, Google Workspace
                  </strong>{" "}
                  — infrastructure providers that host our servers, DNS,
                  source code, and email. They process data on our behalf
                  under their own SOC 2-certified controls.
                </li>
                <li>
                  <strong className="text-foreground">
                    Discord
                  </strong>{" "}
                  — if you interact with our Discord server, your Discord-
                  visible identifiers (username, user ID) are processed
                  through Discord&apos;s platform. Discord also processes
                  any DMs we send you about your order.
                </li>
                <li>
                  <strong className="text-foreground">
                    Whatnot (if you purchase via our Whatnot shop)
                  </strong>{" "}
                  — for orders placed through Whatnot, your order data is
                  processed by Whatnot per their published privacy policy.
                  This applies only if you purchase via Whatnot; the
                  itzenzo.tv website itself does not share data with
                  Whatnot.
                </li>
                <li>
                  <strong className="text-foreground">
                    Law enforcement or regulators
                  </strong>{" "}
                  — only when legally required to disclose (subpoena,
                  court order, or formal regulatory request).
                </li>
              </ul>
              <p>
                <strong className="text-foreground">
                  We never sell your personal data to third parties under
                  any circumstances.
                </strong>
              </p>
            </div>
          </section>

          <section>
            <h2 id="where-stored" className={H2}>
              5. Where your data is stored
            </h2>
            <div className={BODY}>
              <p>
                All personal data is stored and processed exclusively within
                the United States. Our servers are hosted on DigitalOcean
                infrastructure in the United States (New Jersey datacenter).
                The operator accesses the systems from the operator&apos;s
                workplace in Brooklyn, New York. Third-party processors
                (Stripe, Cloudflare, Google Workspace, GitHub, Discord) are
                US-headquartered companies serving your data through their
                US infrastructure.
              </p>
              <p>
                We do not transfer your personal data outside the United
                States.
              </p>
            </div>
          </section>

          <section>
            <h2 id="retention" className={H2}>
              6. How long we keep your data
            </h2>
            <div className={BODY}>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">Order records</strong>{" "}
                  — 7 years (US tax record-keeping requirement under IRS
                  rules). After that, records may be deleted or anonymized.
                </li>
                <li>
                  <strong className="text-foreground">
                    Buyer contact information
                  </strong>{" "}
                  — retained as long as the buyer relationship is active or
                  as required for warranty, refund, or dispute purposes.
                </li>
                <li>
                  <strong className="text-foreground">Server logs</strong>{" "}
                  — rotated weekly, retained 30 days for incident
                  investigation, then deleted.
                </li>
                <li>
                  <strong className="text-foreground">
                    Buyer-requested deletion
                  </strong>{" "}
                  — see Section 7. Honored within 30 days for any data not
                  subject to legal retention.
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 id="your-rights" className={H2}>
              7. Your rights
            </h2>
            <div className={BODY}>
              <p>
                You have the right to know what personal data we hold about
                you, correct it if it&apos;s wrong, and request deletion of
                data not subject to legal retention. Specifically:
              </p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">
                    Right of access
                  </strong>{" "}
                  — request a copy of the personal data we hold about you.
                </li>
                <li>
                  <strong className="text-foreground">
                    Right of correction
                  </strong>{" "}
                  — request correction of inaccurate or incomplete data.
                </li>
                <li>
                  <strong className="text-foreground">
                    Right of deletion
                  </strong>{" "}
                  — request deletion of personal data not subject to legal
                  retention. Order records older than 7 years are eligible
                  for deletion; current-year records cannot be deleted while
                  tax retention is active.
                </li>
                <li>
                  <strong className="text-foreground">
                    Right to opt out of communications
                  </strong>{" "}
                  — we don&apos;t send marketing communications. If you want
                  to stop receiving Discord DMs about your orders, unlink
                  your Discord account or contact us.
                </li>
                <li>
                  <strong className="text-foreground">
                    California / state-level rights (CCPA, CPRA)
                  </strong>{" "}
                  — California residents and residents of other US states
                  with similar privacy laws may have additional rights
                  granted by state law. We honor all such rights to the
                  extent they apply to our processing of your data.
                </li>
              </ul>
              <p>
                To exercise any of these rights, email{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-accent underline"
                >
                  {CONTACT_EMAIL}
                </a>{" "}
                with your request. We&apos;ll respond within 30 days. We may
                ask you to verify your identity (typically by confirming the
                email address on file for an order) before honoring access
                or deletion requests.
              </p>
            </div>
          </section>

          <section>
            <h2 id="cookies" className={H2}>
              8. Cookies and similar technologies
            </h2>
            <div className={BODY}>
              <p>itzenzo.tv uses cookies and similar technologies for:</p>
              <ul className={UL}>
                <li>
                  <strong className="text-foreground">
                    Essential session functionality
                  </strong>{" "}
                  — keeping you logged in (where applicable), preserving
                  your cart contents, and recording your acceptance of the
                  terms of service at checkout.
                </li>
                <li>
                  <strong className="text-foreground">
                    Security
                  </strong>{" "}
                  — Cloudflare may set technical cookies to verify legitimate
                  browser traffic and protect against bot abuse.
                </li>
              </ul>
              <p>
                We do not use third-party advertising cookies, behavioral
                tracking pixels, or cross-site trackers. We do not share
                cookie data with marketing networks.
              </p>
            </div>
          </section>

          <section>
            <h2 id="children" className={H2}>
              9. Children&apos;s privacy
            </h2>
            <div className={BODY}>
              <p>
                itzenzo.tv is not directed to children under 13, and we do
                not knowingly collect personal data from anyone under 13.
                If you believe a child under 13 has provided personal data
                to us, please contact us so we can delete it.
              </p>
            </div>
          </section>

          <section>
            <h2 id="changes" className={H2}>
              10. Changes to this policy
            </h2>
            <div className={BODY}>
              <p>
                We may update this policy as the business or applicable
                privacy law evolves. The date of the most recent update is
                shown at the top of this page, along with the policy
                version number. Material changes will be communicated
                through a notice on the site or by email to recent buyers
                where appropriate. The version your data was processed
                under at the time of any specific transaction stays tied
                to that transaction in our records.
              </p>
            </div>
          </section>

          <section>
            <h2 id="contact" className={H2}>
              11. Contact us
            </h2>
            <div className={BODY}>
              <p>
                Questions about this policy, requests to exercise any of
                your rights, or concerns about how we&apos;ve handled your
                data — email us at{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-accent underline"
                >
                  {CONTACT_EMAIL}
                </a>
                . We aim to respond within 24 hours on business days, and
                always within 30 days for formal data subject requests.
              </p>
              <p>
                For matters covered by our terms of service, see{" "}
                <Link href="/legal/terms" className="text-accent underline">
                  /legal/terms
                </Link>
                .
              </p>
            </div>
          </section>
        </article>
      </Container>
    </>
  );
}
