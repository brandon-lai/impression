/**
 * The daily prompt (PRD 10).
 *
 * A blank microphone is intimidating and most people will not know what to
 * say. Because the concept is representational, prompts that suggest a subject
 * work better than tongue twisters -- they trade a little comparison purity for
 * a much stronger individual result, because the semantic layer then picks a
 * subject the person recognises as fitting what they said.
 *
 * The rotation is a pure function of the date, so it needs no database and is
 * identical on the server and the client. The prompts table exists for when
 * one wants to be scheduled by hand; this list is the default.
 */

export interface Prompt {
  id: string;
  text: string;
}

export const PROMPTS: Prompt[] = [
  { id: "calm", text: "Describe somewhere you felt calm" },
  { id: "travel", text: "Talk about the last place you travelled" },
  { id: "street", text: "Describe your street" },
  { id: "room", text: "Tell me about a room you remember" },
  { id: "now", text: "Say what you can see right now" },
  { id: "weather", text: "Describe the weather where you are" },
  { id: "morning", text: "Talk about this morning" },
];

/** `date` as YYYY-MM-DD. Kept as a string so the server and the browser cannot
 *  disagree about the timezone and render two different prompts. */
export function promptFor(date: string): Prompt {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
  return PROMPTS[h % PROMPTS.length];
}

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
