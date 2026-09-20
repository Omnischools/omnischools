import { env } from "@/lib/env";

/**
 * Observability shims (BUILD_STACK: Sentry errors, PostHog product analytics).
 * Dormant by default — no events emitted unless DSN/key present. Real SDKs are
 * wired at deploy; feature code calls these stable signatures meanwhile.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (env.NEXT_PUBLIC_SENTRY_DSN) {
    // TODO(deploy): forward to Sentry once @sentry/nextjs is wired.
  }
  console.error("[observability] error", error, context ?? "");
}

export function captureEvent(name: string, properties?: Record<string, unknown>): void {
  if (env.NEXT_PUBLIC_POSTHOG_KEY) {
    // TODO(deploy): forward to PostHog once posthog-js is wired.
  }
  if (env.NODE_ENV === "development") {
    console.debug(`[observability] event: ${name}`, properties ?? "");
  }
}
