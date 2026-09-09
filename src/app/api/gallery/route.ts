import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";
import { todayKey } from "@/lib/prompts";
import { gunzipSync } from "node:zlib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Today's gallery (PRD 10). Today's prompt only -- deliberately not a general
 * public feed, which on a side project is a moderation liability rather than a
 * feature.
 */
export async function GET() {
  if (!hasDatabase) return NextResponse.json({ date: todayKey(), pieces: [] });

  const rows = await db()`
    select id, title, subject, seed, events, duration_ms
    from pieces
    where is_public
      and moderation_status = 'approved'
      and created_at >= date_trunc('day', now())
    order by created_at desc
    limit 24`;

  return NextResponse.json({
    date: todayKey(),
    pieces: rows.map((r) => ({
      id: r.id,
      title: r.title,
      subject: r.subject,
      seed: Number(r.seed),
      durationMs: r.duration_ms,
      events: JSON.parse(gunzipSync(r.events as Buffer).toString("utf8")),
    })),
  });
}
