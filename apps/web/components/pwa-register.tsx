"use client";
import { useEffect } from "react";

/**
 * Registers the service worker in production only (keeps dev free of SW caching).
 * Mounted once in the root layout.
 */
export function PwaRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // registration failures are non-fatal
      });
    }
  }, []);
  return null;
}
