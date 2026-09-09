import { NextRequest, NextResponse } from "next/server";

/**
 * Final transcription (PRD 7.6).
 *
 * Groq whisper-large-v3-turbo, with word timestamps. Word timestamps are the
 * whole point of this call: without them a word's colour cannot be aligned to
 * the cluster it was spoken in, and the colour layer decouples from the
 * structural layer. The live Web Speech transcript has no timestamps at all,
 * which is why it only ever drives the provisional palette.
 *
 * Unconfigured, this returns 503 and the client keeps its live transcript.
 * That is the correct degradation: the piece is still fully painted.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 4 * 1024 * 1024; // a 30s opus clip is ~240KB

export async function POST(req: NextRequest) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "transcription is not configured", words: [] },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "audio file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "audio too large" }, { status: 413 });
  }

  const out = new FormData();
  out.append("file", file, "clip.webm");
  out.append("model", "whisper-large-v3-turbo");
  out.append("response_format", "verbose_json");
  out.append("timestamp_granularities[]", "word");
  out.append("language", "en");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: out,
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "transcription failed", status: res.status, words: [] },
      { status: 502 },
    );
  }

  const json = (await res.json()) as {
    text?: string;
    words?: { word: string; start: number; end: number }[];
  };

  return NextResponse.json({
    text: json.text ?? "",
    words: (json.words ?? []).map((w) => ({
      word: w.word.toLowerCase().replace(/[^a-z'-]/g, ""),
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
    })).filter((w) => w.word.length > 0),
  });
}
