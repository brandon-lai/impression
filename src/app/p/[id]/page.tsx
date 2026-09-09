import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db, hasDatabase } from "@/lib/db";
import { gunzipSync } from "node:zlib";
import { SharePlayer } from "@/components/SharePlayer";
import { PaintEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

interface Row {
  id: string; seed: string | number; title: string; duration_ms: number;
  events: Buffer; audio_key: string | null; still_key: string | null;
}

async function load(id: string): Promise<Row | null> {
  if (!hasDatabase) return null;
  const rows = await db()`
    select id, seed, title, duration_ms, events, audio_key, still_key
    from pieces where id = ${id} limit 1`;
  return (rows[0] as Row | undefined) ?? null;
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const row = await load(id).catch(() => null);
  if (!row) return { title: "Impression" };
  return {
    title: `${row.title} · Impression`,
    description: "A painting made from someone's voice.",
    openGraph: {
      title: row.title,
      description: "Turn your voice into an impressionist painting.",
      // The link preview is the finished still, which is what people actually
      // see when this is pasted anywhere (PRD 7.9).
      images: row.still_key ? [{ url: `/api/pieces/${id}/still`, width: 2048, height: 1536 }] : [],
      type: "article",
    },
    twitter: { card: row.still_key ? "summary_large_image" : "summary" },
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await load(id);
  if (!row) notFound();

  const events = JSON.parse(gunzipSync(row.events).toString("utf8")) as PaintEvent[];
  return (
    <SharePlayer
      events={events}
      seed={Number(row.seed)}
      title={row.title}
      durationMs={row.duration_ms}
      // No audio served at all when the piece has none (PRD 7.9).
      audioSrc={row.audio_key ? `/api/pieces/${id}/audio` : null}
    />
  );
}
