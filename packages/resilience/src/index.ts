/**
 * @erp/resilience — circuit breaker y retry con jitter
 * Ligero, sin dependencias externas, para DB/Redis y eventBus.
 * Inspirado en cockatiel/opossum pero implementado nativo para no añadir peso.
 */

export interface RetryOptions {
  retries?: number; // intentos totales (default 5)
  baseDelayMs?: number; // delay base (default 200)
  maxDelayMs?: number; // cap (default 5000)
  jitterFactor?: number; // 0..1 fraction (default 0.2)
  factor?: number; // exponential factor (default 2)
}

function jitter(delay: number, factor: number): number {
  const rand = Math.random() * 2 - 1; // -1..1
  return Math.max(0, delay + delay * factor * rand);
}

export function exponentialBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  factor = 2,
  jitterFactor = 0.2
): number {
  const exp = baseDelayMs * Math.pow(factor, attempt - 1);
  const capped = Math.min(exp, maxDelayMs);
  return Math.round(jitter(capped, jitterFactor));
}

/**
 * Reintenta fn con backoff exponencial + jitter.
 * Lanza el último error si agota retries.
 */
export async function retryWithJitter<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    retries = 5,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    jitterFactor = 0.2,
    factor = 2,
  } = opts;
  let last: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (attempt === retries) break;
      const delay = exponentialBackoffMs(attempt, baseDelayMs, maxDelayMs, factor, jitterFactor);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw last;
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitOptions {
  failureThreshold?: number; // fallos consecutivos para abrir (default 5)
  resetTimeoutMs?: number; // tiempo en open antes de half_open (default 10000)
  halfOpenMaxCalls?: number; // calls permitidas en half_open (default 2)
  successThreshold?: number; // successes en half_open para cerrar (default 2)
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private halfOpenCalls = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxCalls: number;
  private readonly successThreshold: number;

  constructor(opts: CircuitOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 10_000;
    this.halfOpenMaxCalls = opts.halfOpenMaxCalls ?? 2;
    this.successThreshold = opts.successThreshold ?? 2;
  }

  getState(): CircuitState {
    this.maybeTransition();
    return this.state;
  }

  private maybeTransition(): void {
    if (this.state === "open" && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = "half_open";
      this.halfOpenCalls = 0;
      this.successes = 0;
    }
  }

  private recordSuccess(): void {
    if (this.state === "half_open") {
      this.successes += 1;
      if (this.successes >= this.successThreshold) {
        this.state = "closed";
        this.failures = 0;
        this.successes = 0;
      }
    } else if (this.state === "closed") {
      this.failures = 0;
    }
  }

  private recordFailure(): void {
    if (this.state === "half_open") {
      this.state = "open";
      this.openedAt = Date.now();
      this.successes = 0;
    } else if (this.state === "closed") {
      this.failures += 1;
      if (this.failures >= this.failureThreshold) {
        this.state = "open";
        this.openedAt = Date.now();
      }
    }
  }

  /**
   * Ejecuta fn protegida por circuito.
   * Si está open, lanza CircuitOpenError inmediatamente (sin llamar fn).
   */
  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransition();
    if (this.state === "open") {
      throw new CircuitOpenError(`Circuit open (failures=${this.failures})`, this.state);
    }
    if (this.state === "half_open" && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new CircuitOpenError("Circuit half_open max calls exceeded", this.state);
    }
    if (this.state === "half_open") this.halfOpenCalls += 1;

    try {
      const res = await fn();
      this.recordSuccess();
      return res;
    } catch (e) {
      this.recordFailure();
      throw e;
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitState
  ) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

/**
 * Wrap genérico para pool.query / redis ping con breaker.
 * Uso: const dbBreaker = new CircuitBreaker({ failureThreshold: 3 });
 * await dbBreaker.exec(() => pool.query("SELECT 1"));
 */
export function createBreaker(opts?: CircuitOptions): CircuitBreaker {
  return new CircuitBreaker(opts);
}

/**
 * waitFor con jitter — para waitForDatabase
 * Llama fn hasta que resuelva o agote retries, con backoff+jitter.
 */
export async function waitForWithJitter(
  fn: () => Promise<void>,
  retries = 10,
  baseDelayMs = 500,
  maxDelayMs = 5000
): Promise<void> {
  return retryWithJitter(fn, {
    retries,
    baseDelayMs,
    maxDelayMs,
    jitterFactor: 0.25,
    factor: 1.8,
  });
}
