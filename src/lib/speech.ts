"use client";

/**
 * Live transcription via the Web Speech API (PRD 7.6).
 *
 * Free and instant, Chrome and Safari only. Firefox has no support: it degrades
 * silently to structure-only live painting with the subject palette, and the
 * semantic layer arrives with the final pass. No browser warning -- the PRD is
 * explicit about that, and it is right: a warning would draw attention to a
 * difference the user cannot act on.
 *
 * Web Speech gives no word-level timestamps, so words are stamped with the
 * moment their result arrived. That is good enough to colour the cluster being
 * painted right now, and it is replaced wholesale by Groq's real word
 * timestamps in the final pass.
 */

import { TimedWord } from "./audio/compose";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

function ctor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | null;
}

export const speechSupported = () => ctor() !== null;

export class LiveSpeech {
  private rec: SpeechRecognitionLike | null = null;
  private words: TimedWord[] = [];
  private startedAt = 0;
  private stopped = false;

  constructor(private onWords?: (w: TimedWord[]) => void) {}

  start(): void {
    const C = ctor();
    if (!C) return;
    this.startedAt = performance.now();
    this.stopped = false;
    const rec = new C();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    let committed = 0;
    rec.onresult = (e) => {
      const now = performance.now() - this.startedAt;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const text = r[0].transcript.trim();
        if (!text) continue;
        const parts = text.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(Boolean);
        // Spread this result's words back over the span since the last final
        // result, so they land on the breath groups they belong to.
        const span = Math.max(400, now - committed);
        parts.forEach((word, k) => {
          const a = committed + (span * k) / parts.length;
          this.words.push({ word, startMs: a, endMs: a + span / parts.length });
        });
        committed = now;
      }
      this.onWords?.(this.words);
    };
    // Recognition stops itself after a silence. Restart it: a 30 second clip
    // with a long pause in the middle would otherwise lose its second half.
    rec.onend = () => { if (!this.stopped) { try { rec.start(); } catch { /* already starting */ } } };
    rec.onerror = () => { /* silent by design (PRD 7.6) */ };
    try { rec.start(); } catch { /* not available */ }
    this.rec = rec;
  }

  stop(): TimedWord[] {
    this.stopped = true;
    try { this.rec?.stop(); } catch { /* not started */ }
    this.rec = null;
    return this.words;
  }

  get transcript(): string {
    return this.words.map((w) => w.word).join(" ");
  }
}
