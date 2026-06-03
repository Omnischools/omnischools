import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Portability pattern (BUILD_STACK): background jobs are generic HTTP POST endpoints
 * guarded by a shared secret header — Vercel Cron calls them today, pg_cron / a systemd
 * timer can call them tomorrow with no code change. This is the reference example;
 * real jobs (nightly snapshot, ETL) follow the same shape.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ran: "health", at: new Date().toISOString() });
}
