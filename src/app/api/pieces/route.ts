import { NextRequest, NextResponse } from "next/server";
import { db, hasDatabase, newId, newDeleteToken } from "@/lib/db";
import { moderate } from "@/lib/moderation";
import { gzipSync } from "node:zlib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A 30s piece is 100-250 events and a few KB gzipped (PRD 7.3). Anything an
 *  order of magnitude past that is not a piece this product made. */
const MAX_EVENTS = 2000;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

interface Body {
  events: unknown[];
  seed: number;
  subject: string;
  runnerUp?: string;
  light: string;
  title: string;
  durationMs: number;
  /** Null whenever the user excluded audio. The text of something they chose
   *  not to share is not stored either (PRD 8, 11). */
  transcript?: string | null;
  audioBase64?: string | null;
  audioMime?: string | null;
  /** PNG of the final pass, for the link preview. */
  stillBase64?: string | null;
  isPublic?: boolean;
  promptId?: string | null;
}

export async function POST(req: NextRequest) {
  if (!hasDatabase) {
    // Refuse loudly rather than pretend. The client falls back to the
    // self-contained fragment share, which is honest about carrying no audio.
    return NextResponse.json(
      { error: "no_database", message: "Sharing by link needs a database. Use the fallback link." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > MAX_EVENTS) {
    return NextResponse.json({ error: "events out of range" }, { status: 400 });
  }
  if (typeof body.title !== "string" || body.title.length > 120) {
    return NextResponse.json({ error: "bad title" }, { status: 400 });
  }
  if (!Number.isFinite(body.durationMs) || body.durationMs <= 0 || body.durationMs > 40_000) {
    return NextResponse.json({ error: "bad duration" }, { status: 400 });
  }

  // Audio excluded => transcript is not stored either.
  const keepAudio = Boolean(body.audioBase64);
  const transcript = keepAudio ? (body.transcript ?? null) : null;

  let audio: Buffer | null = null;
  if (keepAudio) {
    audio = Buffer.from(body.audioBase64!, "base64");
    if (audio.length > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "audio too large" }, { status: 413 });
    }
  }

  let still: Buffer | null = null;
  if (body.stillBase64) {
    still = Buffer.from(body.stillBase64, "base64");
    if (still.length > 6 * 1024 * 1024) still = null; // preview only; never worth failing the share
  }

  const id = newId();
  const deleteToken = newDeleteToken();
  const events = gzipSync(Buffer.from(JSON.stringify(body.events), "utf8"));
  const status = body.isPublic ? moderate(transcript) : "pending";

  const sql = db();
  await sql.begin(async (tx) => {
    await tx`
      insert into pieces (
        id, seed, subject, subject_runner_up, light, title, events, duration_ms,
        transcript, audio_key, prompt_id, is_public, moderation_status, delete_token
      ) values (
        ${id}, ${Math.trunc(body.seed)}, ${body.subject}, ${body.runnerUp ?? null},
        ${body.light}, ${body.title}, ${events}, ${Math.round(body.durationMs)},
        ${transcript}, ${audio ? `db:${id}` : null}, ${body.promptId ?? null},
        ${Boolean(body.isPublic)}, ${status}, ${deleteToken}
      )`;
    if (audio) {
      await tx`insert into piece_audio (piece_id, mime_type, bytes)
               values (${id}, ${body.audioMime ?? "audio/webm"}, ${audio})`;
    }
    if (still) {
      await tx`insert into piece_still (piece_id, bytes) values (${id}, ${still})`;
      await tx`update pieces set still_key = ${`db:${id}`} where id = ${id}`;
    }
  });

  return NextResponse.json({ id, deleteToken, moderationStatus: status }, { status: 201 });
}
