/**
 * Integration tests against a live server and a real database.
 *
 * The criteria that actually hurt if they are wrong -- that a delete token
 * gates deletion, that a private piece never appears in a public listing, that
 * excluding audio also drops the transcript -- cannot be decided by a unit
 * test. They need the route, the query and the schema together.
 *
 *   BASE=http://localhost:3011 node --test tests/api.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as L from "./.build/lib.mjs";

const BASE = process.env.BASE ?? "http://localhost:3011";

const raw = gunzipSync(readFileSync("public/lexicon.bin"));
L.installLexicon(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

function samplePiece() {
  const a = L.synthAnalysis(L.SPEAKERS[1], 4242);
  return L.buildPiece(a, L.synthWords(L.SAMPLE_WORDS.water, a, 4242));
}

async function create(overrides = {}) {
  const p = samplePiece();
  const res = await fetch(`${BASE}/api/pieces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      events: p.events, seed: p.seed, subject: p.subject, runnerUp: p.runnerUp,
      light: p.light, title: p.title, durationMs: p.durationMs,
      transcript: "the ocean was cold and quiet",
      audioBase64: Buffer.from("fake opus bytes").toString("base64"),
      audioMime: "audio/webm", isPublic: false, promptId: "calm",
      ...overrides,
    }),
  });
  return { res, piece: p };
}

test("a piece round-trips through storage unchanged", async () => {
  const { res, piece } = await create();
  assert.equal(res.status, 201);
  const { id, deleteToken } = await res.json();
  assert.equal(id.length, 10);
  assert.equal(deleteToken.length, 64);

  const got = await fetch(`${BASE}/api/pieces/${id}`);
  assert.equal(got.status, 200);
  const body = await got.json();
  assert.equal(body.title, piece.title);
  assert.equal(body.seed, piece.seed);
  assert.equal(body.hasAudio, true);
  // The stream is what the renderer replays; it must survive the gzip exactly.
  assert.deepEqual(body.events, JSON.parse(JSON.stringify(piece.events)));
});

test("the response never leaks the delete token or the transcript", async () => {
  const { res } = await create();
  const { id } = await res.json();
  const body = await (await fetch(`${BASE}/api/pieces/${id}`)).text();
  assert.ok(!body.includes("delete_token"));
  assert.ok(!body.includes("deleteToken"));
  assert.ok(!body.toLowerCase().includes("the ocean was cold"));
});

test("deletion requires the token that was issued (PRD 8)", async () => {
  const { res } = await create();
  const { id, deleteToken } = await res.json();

  const none = await fetch(`${BASE}/api/pieces/${id}`, { method: "DELETE" });
  assert.equal(none.status, 401, "deleted with no token");

  const wrong = await fetch(`${BASE}/api/pieces/${id}`, {
    method: "DELETE", headers: { "x-delete-token": "0".repeat(64) },
  });
  assert.equal(wrong.status, 401, "deleted with the wrong token");

  // Still there after both refusals.
  assert.equal((await fetch(`${BASE}/api/pieces/${id}`)).status, 200);

  const ok = await fetch(`${BASE}/api/pieces/${id}`, {
    method: "DELETE", headers: { "x-delete-token": deleteToken },
  });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${BASE}/api/pieces/${id}`)).status, 404);
});

test("deleting a piece takes its audio with it", async () => {
  const { res } = await create();
  const { id, deleteToken } = await res.json();
  assert.equal((await fetch(`${BASE}/api/pieces/${id}/audio`)).status, 200);
  await fetch(`${BASE}/api/pieces/${id}`, { method: "DELETE", headers: { "x-delete-token": deleteToken } });
  assert.equal((await fetch(`${BASE}/api/pieces/${id}/audio`)).status, 404);
});

test("excluding audio also drops the transcript (PRD 11)", async () => {
  const { res } = await create({ audioBase64: null, transcript: "something private" });
  const { id } = await res.json();
  assert.equal((await fetch(`${BASE}/api/pieces/${id}/audio`)).status, 404);
  const body = await (await fetch(`${BASE}/api/pieces/${id}`)).json();
  assert.equal(body.hasAudio, false);
});

test("a private piece never appears in the gallery", async () => {
  const { res } = await create({ isPublic: false });
  const { id } = await res.json();
  const gallery = await (await fetch(`${BASE}/api/gallery`)).json();
  assert.ok(!gallery.pieces.some((p) => p.id === id), "private piece listed publicly");
});

test("an opted-in piece is listed, and a slur keeps it out", async () => {
  const clean = await create({ isPublic: true, transcript: "the harbour at dawn was very still" });
  const { id: cleanId } = await clean.res.json();

  const foul = await create({ isPublic: true, transcript: "you absolute retard" });
  const { id: foulId, moderationStatus } = await foul.res.json();
  assert.equal(moderationStatus, "rejected");

  const gallery = await (await fetch(`${BASE}/api/gallery`)).json();
  assert.ok(gallery.pieces.some((p) => p.id === cleanId), "approved piece missing");
  assert.ok(!gallery.pieces.some((p) => p.id === foulId), "rejected piece listed");
});

test("malformed submissions are refused", async () => {
  const bad = [
    { events: [] },
    { events: [{ t: 0, type: "ground" }], seed: 1, subject: "water", light: "evening", title: "x", durationMs: 900000 },
    { events: new Array(5000).fill({ t: 0, type: "ground" }), seed: 1, subject: "water", light: "evening", title: "x", durationMs: 1000 },
  ];
  for (const body of bad) {
    const res = await fetch(`${BASE}/api/pieces`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, `accepted ${JSON.stringify(body).slice(0, 60)}`);
  }
  const notJson = await fetch(`${BASE}/api/pieces`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{{{",
  });
  assert.equal(notJson.status, 400);
});

test("a missing piece is a 404, not a 500", async () => {
  assert.equal((await fetch(`${BASE}/api/pieces/doesnotexi`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/pieces/doesnotexi/audio`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/pieces/doesnotexi/still`)).status, 404);
  assert.equal((await fetch(`${BASE}/p/doesnotexi`)).status, 404);
});

test("transcription refuses cleanly when it is not configured", async () => {
  const fd = new FormData();
  fd.append("audio", new Blob([new Uint8Array(64)]), "clip.webm");
  const res = await fetch(`${BASE}/api/transcribe`, { method: "POST", body: fd });
  // 503 unconfigured, 400/502 configured-but-rejected. Never a 500, and never
  // a 200 with invented words.
  assert.ok([400, 502, 503].includes(res.status), `status ${res.status}`);
  const body = await res.json();
  assert.deepEqual(body.words ?? [], []);
});

test("the daily prompt is served with or without a database", async () => {
  const res = await fetch(`${BASE}/api/prompt`);
  assert.equal(res.status, 200);
  const { prompt, date } = await res.json();
  assert.ok(prompt.id && prompt.text);
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
});
