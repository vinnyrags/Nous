/**
 * Single canonical normalization for email addresses.
 *
 * SQLite TEXT comparison is case-sensitive by default, so `User@Gmail.com`
 * and `user@gmail.com` would otherwise resolve to different rows in
 * `purchases`, `discord_links`, `shipping_payments`, etc. — fragmenting a
 * returning buyer's identity, breaking shipping-coverage carryover, and
 * producing duplicate Discord links. Normalizing at every write site (and
 * at lookup-input sites) keeps everything keyed by a single canonical form.
 *
 * Returns `null` for empty / non-string input so callers can treat the
 * result as a Maybe<String> and avoid writing empty strings to NOT NULL
 * columns.
 */
export function normalizeEmail(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.toLowerCase();
}
