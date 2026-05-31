"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { CurrentPackBattle as CurrentPackBattleData } from "@/lib/graphql/types";
import { selectValue } from "@/lib/slugify";
import { TERMS_VERSION, TERMS_HREF } from "@/lib/terms";

interface CurrentPackBattleProps {
  data: CurrentPackBattleData;
  discordUrl: string;
}

const isLiveOpen = (data: CurrentPackBattleData): boolean =>
  selectValue(data.cpbStatus) === "open" &&
  Boolean(data.cpbBuyUrl) &&
  Boolean(data.cpbProduct);

const isInProgress = (data: CurrentPackBattleData): boolean =>
  selectValue(data.cpbStatus) === "in_progress" && Boolean(data.cpbProduct);

export default function CurrentPackBattle({
  data,
  discordUrl,
}: CurrentPackBattleProps) {
  const live = isLiveOpen(data);
  const inProgress = isInProgress(data);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="text-xs font-bold uppercase tracking-wide text-foreground">
        Pack Battles
      </div>
      {live || inProgress ? (
        <ActiveState data={data} live={live} />
      ) : (
        <IdleState discordUrl={discordUrl} />
      )}
    </div>
  );
}

function ActiveState({
  data,
  live,
}: {
  data: CurrentPackBattleData;
  live: boolean;
}) {
  const product = data.cpbProduct!;
  const image = product.featuredImage?.node;
  const max = data.cpbMaxEntries ?? 0;
  const paid = data.cpbPaidEntries ?? 0;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) setConfirmOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmOpen, pending]);

  async function handleBuy() {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/pack-battle-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms_version: TERMS_VERSION }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(
          body?.message ||
            "Could not start checkout. Try again in a moment.",
        );
        return;
      }

      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col rounded-lg border border-border bg-surface/60 p-6">
      <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-accent">
        <span aria-hidden="true">⚔️</span>
        <span>{live ? "Open" : "In Progress"}</span>
      </div>

      <div className="flex flex-1 flex-col gap-4 sm:flex-row">
        {image && (
          <div className="relative aspect-[3/4] w-full max-w-[160px] overflow-hidden rounded-md bg-surface sm:w-[40%]">
            <Image
              src={image.sourceUrl}
              alt={image.altText || product.title}
              fill
              sizes="(max-width: 640px) 50vw, 200px"
              className="object-cover"
            />
          </div>
        )}

        <div className="flex flex-1 flex-col">
          <h3 className="text-lg font-bold leading-tight text-foreground">
            {product.title}
          </h3>

          {live ? (
            <p className="mt-2 text-sm text-muted">
              {paid}/{max} spots filled · purchase = entry, no shipping at
              buy-in.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Battle in progress! 🔥 Entries are closed — opening packs on
              stream now.
            </p>
          )}

          {error && live && (
            <p className="mt-2 text-xs text-red-500">{error}</p>
          )}

          <div className="mt-auto flex flex-col gap-2 pt-4 sm:flex-row sm:items-center">
            {live ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={pending}
                  className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  {pending ? "…" : "Buy In"}
                </button>
                <a
                  href={data.cpbBuyUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted underline hover:text-foreground sm:ml-1"
                >
                  Or enter on Discord →
                </a>
              </>
            ) : (
              <span className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
                <span aria-hidden="true">🔒</span> No new entries
              </span>
            )}
          </div>
        </div>
      </div>

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pack-battle-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!pending) setConfirmOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="pack-battle-confirm-title"
              className="text-lg font-bold text-foreground"
            >
              Confirm pack-battle entry
            </h2>
            <p className="mt-3 text-sm text-foreground">
              <strong>{product.title}</strong> — purchase enters you in the
              current pack battle. The winner is shipped the prize after
              the stream; entrants are not charged shipping at buy-in.
            </p>
            <p className="mt-3 text-xs text-muted">
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
            <div className="mt-6 flex justify-start gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBuy}
                disabled={pending}
                className="btn btn-primary"
              >
                {pending ? "…" : "Agree & Continue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IdleState({ discordUrl }: { discordUrl: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center rounded-lg border border-dashed border-border bg-surface/30 p-6 text-sm text-muted">
      <p>
        No live pack battle right now. Catch the next one on{" "}
        <a
          href="https://tiktok.com/@itzenzoTTV"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          TikTok
        </a>{" "}
        — battles announce in{" "}
        <a
          href={discordUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          #pack-battles
        </a>{" "}
        as soon as they start.
      </p>
    </div>
  );
}
