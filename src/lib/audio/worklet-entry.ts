/**
 * The AudioWorklet processor (PRD 7.2).
 *
 * Runs on the audio thread so the main thread stays free for 60fps rendering.
 * It does framing and calls the pure extraction functions in `features.ts` --
 * it holds no analysis logic of its own, which is what lets the upload path
 * call those same functions from a Web Worker later without a rewrite.
 *
 * Bundled to public/worklet/features.worklet.js by scripts/build-worklet.mjs.
 * AudioWorklets get no module resolution, so the bundle is the deliverable.
 */

import {
  FRAME, HOP, FEATURE_HZ, hann, magnitudeSpectrum, rms, toDb,
  spectralCentroid, spectralFlux, detectPitch, decimate,
} from "./features";

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

const PITCH_DECIMATION = 8;

class FeatureProcessor extends AudioWorkletProcessor {
  private ring = new Float32Array(FRAME);
  private filled = 0;
  private window = hann(FRAME);
  private mag = new Float32Array(FRAME >> 1);
  private prevMag = new Float32Array(FRAME >> 1);
  private hasPrev = false;
  private samples = 0;

  // 20Hz output means several analysis frames per emitted feature; they are
  // aggregated rather than decimated so a transient is not simply dropped.
  private accRms = 0;
  private accCentroid = 0;
  private accCount = 0;
  private accFlux = 0;
  private bestF0 = 0;
  private bestClarity = 0;
  private lastEmit = -1;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      this.ring[this.filled++] = input[i];
      this.samples++;
      if (this.filled < FRAME) continue;

      this.analyse(this.ring);

      // slide by HOP
      this.ring.copyWithin(0, HOP);
      this.filled = FRAME - HOP;
    }
    return true;
  }

  private analyse(frame: Float32Array): void {
    const t = this.samples / sampleRate;

    const level = rms(frame);
    magnitudeSpectrum(frame, this.window, this.mag);
    const centroid = spectralCentroid(this.mag, sampleRate);
    const flux = this.hasPrev ? spectralFlux(this.mag, this.prevMag) : 0;
    this.prevMag.set(this.mag);
    this.hasPrev = true;

    // Pitch only when there is something to pitch: silence would otherwise
    // burn the frame budget on a detector that is going to reject the frame.
    let f0 = 0, clarity = 0;
    if (level > 1e-4) {
      const small = decimate(frame, PITCH_DECIMATION);
      const r = detectPitch(small, sampleRate / PITCH_DECIMATION);
      f0 = r.f0;
      clarity = r.clarity;
    }

    this.accRms += level;
    this.accCentroid += centroid;
    this.accFlux = Math.max(this.accFlux, flux);
    this.accCount++;
    if (clarity > this.bestClarity) { this.bestClarity = clarity; this.bestF0 = f0; }

    const slot = Math.floor(t * FEATURE_HZ);
    if (slot !== this.lastEmit && this.accCount > 0) {
      this.lastEmit = slot;
      this.port.postMessage({
        t,
        rmsDb: toDb(this.accRms / this.accCount),
        f0: this.bestF0,
        clarity: this.bestClarity,
        centroid: this.accCentroid / this.accCount,
        flux: this.accFlux,
      });
      this.accRms = 0; this.accCentroid = 0; this.accCount = 0;
      this.accFlux = 0; this.bestF0 = 0; this.bestClarity = 0;
    }
  }
}

registerProcessor("feature-processor", FeatureProcessor);
