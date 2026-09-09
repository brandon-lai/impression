"use client";

/**
 * The database-free share (see lib/share.ts).
 *
 * The whole piece travels in the URL *fragment*, which browsers never send to
 * a server, so this page is rendered entirely from what the recipient's own
 * browser was handed. It carries the painting but not the voice.
 */

import { useEffect, useState } from "react";
import { decodeShare, SharePayload } from "@/lib/share";
import { SharePlayer } from "@/components/SharePlayer";
import Link from "next/link";

export default function FragmentShare() {
  const [payload, setPayload] = useState<SharePayload | null | "error">(null);

  useEffect(() => {
    const frag = window.location.hash.slice(1);
    if (!frag) { setPayload("error"); return; }
    decodeShare(frag).then((p) => setPayload(p ?? "error")).catch(() => setPayload("error"));
  }, []);

  if (payload === "error") {
    return (
      <main className="studio">
        <section className="panel">
          <h1 className="title">That link did not carry a painting.</h1>
          <p className="meta">The whole piece travels in the part of the URL after the #, so it has to be copied whole.</p>
          <div className="controls">
            <Link href="/" className="record" style={{ textDecoration: "none" }}>
              <span className="dot" /><span>Make your own</span>
            </Link>
          </div>
        </section>
      </main>
    );
  }
  if (!payload) return <main className="studio"><section className="panel"><p className="meta">Unpacking…</p></section></main>;

  return (
    <SharePlayer
      events={payload.events}
      seed={payload.seed}
      title={payload.title}
      durationMs={payload.durationMs}
      audioSrc={null}
    />
  );
}
