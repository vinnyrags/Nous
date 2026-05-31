"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PullBoxes as PullBoxesData } from "@/lib/graphql/types";
import Modal from "./Modal";
import { TERMS_VERSION, TERMS_HREF } from "@/lib/terms";

interface PullBoxesProps {
  data: PullBoxesData;
}

interface BoxConfig {
  priceId: string | null;
  title: string;
  description: string;
  price: string;
  unitCents: number;
}

/**
 * The shape `/api/pull-boxes/active` returns. WP serializes `claimedSlots`
 * as an array of { slotNumber, claimStatus, displayLabel } — see
 * PullBoxRepository.serializeBox in the vincentragosta.io repo.
 */
interface ActiveBoxResponse {
  box: ActiveBox | null;
}
interface ActiveBox {
  id: number;
  name: string;
  priceCents: number;
  totalSlots: number;
  claimedSlots: ClaimedSlot[] | null;
}
interface ClaimedSlot {
  slotNumber: number;
  claimStatus: "pending" | "confirmed";
  displayLabel: string;
}

export default function PullBoxes({ data }: PullBoxesProps) {
  const box: BoxConfig = {
    priceId: data.pbPriceId,
    title: data.pbTitle ?? "$5 Pull Box",
    description: data.pbDescription ?? "",
    // The dollar tile on the left of the card. Derived from the title's
    // leading "$N" when present so the WP admin can rename the box without
    // a second config field; falls back to "$5" if nothing parseable.
    price: parsePrefixPrice(data.pbTitle) ?? "$5",
    unitCents: 500,
  };

  if (!box.priceId) {
    return null;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="text-xs font-bold uppercase tracking-wide text-foreground">
        {data.pbHeading ?? "Pull Box"}
      </div>
      <PullBoxCard box={box} />
    </div>
  );
}

function parsePrefixPrice(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = title.match(/^\$\d+(?:\.\d{1,2})?/);
  return m ? m[0] : null;
}

function PullBoxCard({ box }: { box: BoxConfig }) {
  const [isModalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Closed-state count badge: fetched on mount so the buyer sees
  // "X of Y open" without having to open the modal first. The modal
  // does its own fresh fetch on open for live state.
  const [activeBox, setActiveBox] = useState<ActiveBox | null>(null);
  const disabled = !box.priceId;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/pull-boxes/active', { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ActiveBoxResponse | null) => {
        if (cancelled || !data) return;
        setActiveBox(data.box);
      })
      .catch(() => {
        // Silent — the modal's own fetch will surface errors at action time.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openCount = activeBox
    ? activeBox.totalSlots - (activeBox.claimedSlots?.length ?? 0)
    : null;

  return (
    // Mobile: stack tile+body on top, full-width button below. Desktop
    // (sm+): original single inline row (tile | body | button).
    <div className="flex flex-1 flex-col gap-3 rounded-lg border border-border bg-surface/60 p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex flex-1 items-start gap-4 sm:items-center">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md bg-accent/15 text-xl font-bold text-accent">
          {box.price}
        </div>
        <div className="flex flex-1 flex-col">
          {/* Title + count stack vertically on mobile so the count
              doesn't fight the title for horizontal space inside an
              already-narrow body column; inline justify-between at sm+. */}
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
            <div className="text-sm font-bold text-foreground">{box.title}</div>
            {activeBox && openCount !== null && (
              <div className="text-xs font-semibold uppercase tracking-wide text-muted tabular-nums">
                {openCount} of {activeBox.totalSlots} open
              </div>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">{box.description}</p>
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        disabled={disabled}
        // Mobile: indent by the tile width (h-14 = 3.5rem) + the inner
        // gap-4 (1rem) so the button starts flush with the title/
        // description text instead of sitting under the dollar tile.
        // `self-start` keeps the button at its natural width; sm: resets
        // both so the desktop inline row is unchanged.
        className="btn btn-primary ml-[4.5rem] self-start disabled:cursor-not-allowed disabled:opacity-50 sm:ml-0 sm:self-auto"
      >
        Buy In
      </button>

      <PullBoxSlotModal
        box={box}
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        onError={setError}
      />
    </div>
  );
}

function PullBoxSlotModal({
  box,
  isOpen,
  onClose,
  onError,
}: {
  box: BoxConfig;
  isOpen: boolean;
  onClose: () => void;
  onError: (msg: string | null) => void;
}) {
  const [activeBox, setActiveBox] = useState<ActiveBox | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/pull-boxes/active', { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load pull-box state.");
      const data = (await res.json()) as ActiveBoxResponse;
      setActiveBox(data.box);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on open + reset selection so reopening the modal is a clean slate
  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set());
    refresh();
  }, [isOpen, refresh]);

  const claimedSet = new Set(
    (activeBox?.claimedSlots ?? []).map((c) => c.slotNumber),
  );

  function toggleSlot(n: number) {
    if (claimedSet.has(n)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  const selectedCount = selected.size;
  const totalCents = box.unitCents * selectedCount;
  const totalLabel = `$${(totalCents / 100).toFixed(2)}`;
  const titleId = `pull-box-modal-${box.priceId}`;

  async function handleConfirm() {
    if (!box.priceId || pending || selectedCount === 0) return;
    setPending(true);
    onError(null);

    try {
      const slots = [...selected].sort((a, b) => a - b);
      const res = await fetch("/api/pull-box-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: box.priceId,
          slots,
          terms_version: TERMS_VERSION,
        }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      // 409 conflict: someone else just claimed one of our picks.
      // Refresh the grid in-place so the buyer can adjust.
      if (res.status === 409) {
        await refresh();
        // Drop any selections that just became claimed.
        setSelected((prev) => {
          const next = new Set<number>();
          for (const n of prev) {
            const stillOpen = !((data?.data?.claimedSlots as number[]) ?? []).includes(n);
            if (stillOpen) next.add(n);
          }
          return next;
        });
        setLoadError(data.message ?? "One or more slots were just claimed by someone else.");
        return;
      }
      onError(data.message ?? "Could not start checkout. Try again.");
      onClose();
    } catch {
      onError("Network error. Try again.");
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      panelClassName="p-6 max-w-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="text-xl font-bold">
          {activeBox?.name ?? box.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-muted hover:bg-surface hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {loading && (
        <p className="mt-4 text-sm text-muted">Loading slot grid…</p>
      )}

      {!loading && !activeBox && !loadError && (
        <p className="mt-4 text-sm text-muted">
          No pull box is open right now. Check back during the next stream.
        </p>
      )}

      {loadError && (
        <p className="mt-4 text-sm text-red-500">{loadError}</p>
      )}

      {!loading && activeBox && (
        <>
          <p className="mt-2 text-sm text-muted">
            Pick the slots you want — claimed slots are shown but locked.{" "}
            <span className="font-medium text-foreground">
              {activeBox.totalSlots - claimedSet.size} of {activeBox.totalSlots} open.
            </span>
          </p>

          <div
            role="group"
            aria-label="Pull box slot picker"
            className="mt-4 grid grid-cols-10 gap-1.5"
          >
            {Array.from({ length: activeBox.totalSlots }, (_, i) => i + 1).map((n) => {
              const isClaimed = claimedSet.has(n);
              const isSelected = selected.has(n);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={isClaimed || pending}
                  aria-label={`Slot ${n}${isClaimed ? " (claimed)" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => toggleSlot(n)}
                  className={[
                    "flex aspect-square items-center justify-center rounded-md border text-xs font-bold tabular-nums transition",
                    isClaimed
                      ? "border-border bg-surface/30 text-muted/50 cursor-not-allowed line-through"
                      : isSelected
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border bg-surface hover:border-accent/60 hover:bg-accent/10",
                  ].join(" ")}
                >
                  {n}
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
            <span className="text-sm text-muted">
              {selectedCount === 0
                ? "Select at least one slot"
                : `${selectedCount} slot${selectedCount === 1 ? "" : "s"}`}
            </span>
            <span className="text-2xl font-bold tabular-nums">{totalLabel}</span>
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending || selectedCount === 0}
            className="btn btn-primary mt-6 w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "…" : "Continue to checkout"}
          </button>

          {selectedCount > 0 && (
            <p className="mt-3 text-center text-xs text-muted">
              By continuing you agree to the{" "}
              <Link
                href={TERMS_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Terms of Service &amp; Refund Policy
              </Link>{" "}
              (v{TERMS_VERSION}).
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
