import { NextRequest, NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

/** Audio is served through the app, never straight off the table, so that the
 *  storage decision stays an implementation detail and RLS on `piece_audio`
 *  can stay closed to the anon role. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!hasDatabase) return new NextResponse("no database", { status: 503 });

  const rows = await db()`select mime_type, bytes from piece_audio where piece_id = ${id} limit 1`;
  if (!rows.length) return new NextResponse("not found", { status: 404 });

  const bytes = rows[0].bytes as Buffer;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": String(rows[0].mime_type),
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
