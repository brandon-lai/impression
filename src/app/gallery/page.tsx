import Link from "next/link";
import { db, hasDatabase } from "@/lib/db";
import { gunzipSync } from "node:zlib";
import { promptFor, todayKey } from "@/lib/prompts";
import { GalleryGrid, GalleryItem } from "@/components/GalleryGrid";

export const dynamic = "force-dynamic";

/**
 * Today's gallery (PRD 10). Today's prompt only, opt-in per piece, and
 * deliberately not a general public feed -- a feed of user-submitted audio is a
 * moderation liability you do not want on a side project.
 */
export default async function Gallery() {
  const date = todayKey();
  const prompt = promptFor(date);

  let items: GalleryItem[] = [];
  if (hasDatabase) {
    try {
      const rows = await db()`
        select id, title, seed, events, duration_ms
        from pieces
        where is_public and moderation_status = 'approved'
          and created_at >= date_trunc('day', now())
        order by created_at desc limit 24`;
      items = rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        seed: Number(r.seed),
        durationMs: Number(r.duration_ms),
        events: JSON.parse(gunzipSync(r.events as Buffer).toString("utf8")),
      }));
    } catch {
      items = [];
    }
  }

  return (
    <main className="studio">
      <section className="panel">
        <h1 className="title">{prompt.text}</h1>
        <p className="meta">
          Today&apos;s gallery · {items.length} {items.length === 1 ? "piece" : "pieces"}
        </p>
        <div className="controls">
          <Link href="/" className="record" style={{ textDecoration: "none" }}>
            <span className="dot" /><span>Make yours</span>
          </Link>
        </div>
      </section>

      {items.length === 0 ? (
        <p className="meta">
          {hasDatabase
            ? "Nothing has been added today yet."
            : "The gallery needs a database. Pieces still record, paint and share by link."}
        </p>
      ) : (
        <GalleryGrid items={items} />
      )}
    </main>
  );
}
