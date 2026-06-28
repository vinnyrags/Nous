/**
 * Tiny leveled logger — zero-dependency, drop-in for console.
 *
 * Why: the bot runs under systemd → journald on the droplet. Bare
 * console.log lines are hard to filter and alert on. This wraps them with a
 * level + timestamp, and emits one JSON object per line in production so
 * journald/log shippers can parse and alert. In development it stays
 * human-readable.
 *
 * Drop-in mapping (so call sites read the same):
 *   console.log(...)   → logger.info(...)
 *   console.warn(...)  → logger.warn(...)
 *   console.error(...) → logger.error(...)
 *
 * It accepts the same varargs console does; Error args render their stack.
 * Set LOG_LEVEL=debug|info|warn|error to filter (default: info). When the
 * day comes to swap in pino, this is the single seam to change.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
const isProd = process.env.NODE_ENV === 'production';

function format(arg) {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (arg !== null && typeof arg === 'object') {
        try { return JSON.stringify(arg); } catch { return String(arg); }
    }
    return String(arg);
}

function emit(level, sink, args) {
    if (LEVELS[level] < threshold) return;
    const msg = args.map(format).join(' ');
    if (isProd) {
        sink(JSON.stringify({ level, ts: new Date().toISOString(), msg }));
    } else {
        sink(`${level.toUpperCase()} ${msg}`);
    }
}

export const logger = {
    debug: (...args) => emit('debug', console.log, args),
    info: (...args) => emit('info', console.log, args),
    warn: (...args) => emit('warn', console.warn, args),
    error: (...args) => emit('error', console.error, args),
};

export default logger;
