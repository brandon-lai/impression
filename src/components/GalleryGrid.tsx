"use client";

import Link from "next/link";
import { Painting } from "./Painting";
import { PaintEvent } from "@/lib/events";

export interface GalleryItem {
  id: string;
  title: string;
  seed: number;
  durationMs: number;
  events: PaintEvent[];
}

export function GalleryGrid({ items }: { items: GalleryItem[] }) {
  return (
    <div className="grid">
      {items.map((it) => (
        <figure key={it.id}>
          <Link href={`/p/${it.id}`}>
            <div className="canvas-wrap">
              {/* Finished, not forming: a grid of twenty-four simultaneous
                  animations is noise, and the motion budget is one moment. */}
              <Painting events={it.events} seed={it.seed} final />
            </div>
          </Link>
          <figcaption>
            <p className="title">{it.title}</p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
