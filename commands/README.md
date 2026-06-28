# `commands/` — handler layer (read before deleting anything here)

**These files are NOT dead "legacy prefix commands." They are the live
implementation, reused by the slash layer through an adapter.** A naive
"nothing imports `commands/queue.js` as a command" check will wrongly flag
them — trace through the wrappers below before concluding anything is unused.

## The shape

Each `commands/<name>.js` exports a handler with the original signature:

```js
export async function handleQueue(message, args) { … }
```

This is the old `!command` signature. The `!` text dispatcher was removed
2026-05-03 (it never went live post-cutover), but the handlers stayed — they
are the actual logic. Everything calls *into* them; they are an asset, not debt.

## Who calls these handlers

```
Discord slash interaction
        │
        ▼
index.js  SLASH_HANDLERS{}            ← maps "/name" → wrapped handler
        │   (each wrapped in withAudit() from lib/op-audit.js)
        ▼
commands/slash/*.js                   ← the adapter layer
  ├─ factory.js  defineSlashCommand() ← declarative wrapper: role check,
  │                                      deferReply, synthetic message,
  │                                      error handling
  ├─ phase-c.js                       ← uses the factory to wire many
  │                                      handlers (sell, pull, giveaway,
  │                                      coupon, tracking, shipments, …)
  ├─ live.js / queue.js / battle.js / ← hand-written wrappers for the
  │  hype.js / spin.js / sync.js /       higher-frequency commands
  │  duckrace.js / reset.js
  └─ op.js  ROUTE_NAMES[]             ← /op router: invoke a handler by name
        │
        ▼
lib/synthetic-message.js              ← builds a fake `message` so a legacy
                                         (message, args) handler runs unchanged
                                         from a slash `interaction`
        │
        ▼
commands/<name>.js  handleX(message, args)
```

Handlers are **also** consumed directly (not via slash) by:

- `webhooks/stripe.js` — e.g. queue / battle / card-shop / pull updates on
  `checkout.session.completed`.
- `server.js` — checkout routes and queue-channel embed updates.
- `commands/test.js` — the in-Discord test harness (also driven by
  `bin/run-test-suite.mjs`).
- other `commands/*.js` — e.g. `shipping.js` is shared by `card-shop.js`,
  `pull.js`, `battle.js`, `intl.js`, `waive.js`, `interactions.js`.

## Practical rules

- To find real usage of a handler, grep for its **export name**
  (`handleQueue`), not just the file path — wrappers import by relative path
  (`'../queue.js'`), and `op.js`/`phase-c.js` route by name.
- Stripe-dependent handlers (refund, waive, battle, coupon, hype, shipping,
  shipping-audit) are gated at runtime by `STRIPE_GATED_COMMANDS` in
  `index.js` while Stripe is parked (`config.STRIPE_ENABLED`). Gated ≠ dead.
- Keep module load side-effect-free: build external clients (Stripe, etc.)
  lazily inside the handler, not at import — `refund.js`/`waive.js` do this so
  importing them with Stripe parked doesn't throw.
