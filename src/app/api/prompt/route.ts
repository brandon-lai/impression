import { NextResponse } from "next/server";
import { promptFor, todayKey } from "@/lib/prompts";
import { db, hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const date = todayKey();
  // A hand-scheduled prompt for today wins; otherwise the deterministic
  // rotation, which is why this route answers with or without a database.
  if (hasDatabase) {
    try {
      const rows = await db()`select id, text from prompts where active_date = ${date} limit 1`;
      if (rows.length) return NextResponse.json({ date, prompt: { id: rows[0].id, text: rows[0].text } });
    } catch {
      // fall through to the built-in rotation
    }
  }
  return NextResponse.json({ date, prompt: promptFor(date) });
}
