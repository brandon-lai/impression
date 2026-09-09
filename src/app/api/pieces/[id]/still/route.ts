import { NextRequest, NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

/** The link-preview still (PRD 7.9). Cached hard: a piece never changes. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!hasDatabase) return new NextResponse("no database", { status: 503 });

  const rows = await db()`select bytes from piece_still where piece_id = ${id} limit 1`;
  if (!rows.length) return new NextResponse("not found", { status: 404 });

  const bytes = rows[0].bytes as Buffer;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
