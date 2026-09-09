import { NextRequest, NextResponse } from "next/server";
import { db, hasDatabase, safeEqual } from "@/lib/db";
import { gunzipSync } from "node:zlib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!hasDatabase) return NextResponse.json({ error: "no_database" }, { status: 503 });

  const rows = await db()`
    select id, seed, subject, subject_runner_up, light, title, events, duration_ms,
           audio_key, created_at
    from pieces where id = ${id} limit 1`;
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });

  const r = rows[0];
  // delete_token and transcript are deliberately not selected. The token is a
  // credential and must never leave the server; the transcript is the text of
  // what someone said and the share page has no use for it.
  return NextResponse.json({
    id: r.id,
    seed: Number(r.seed),
    subject: r.subject,
    runnerUp: r.subject_runner_up,
    light: r.light,
    title: r.title,
    durationMs: r.duration_ms,
    hasAudio: Boolean(r.audio_key),
    events: JSON.parse(gunzipSync(r.events as Buffer).toString("utf8")),
  });
}

/** Anonymous deletion (PRD 8, 11). The token lives in the maker's localStorage;
 *  people will make something they regret and must be able to remove it without
 *  an account. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!hasDatabase) return NextResponse.json({ error: "no_database" }, { status: 503 });

  const token = req.headers.get("x-delete-token") ?? "";
  if (!token) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const rows = await db()`select delete_token from pieces where id = ${id} limit 1`;
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!safeEqual(String(rows[0].delete_token), token)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  await db()`delete from pieces where id = ${id}`;
  return NextResponse.json({ deleted: true });
}
