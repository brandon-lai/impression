"use client";

/**
 * The record path (PRD 6.1).
 *
 *   getUserMedia -> MediaStreamSource -> AudioWorkletNode   (live features)
 *                                     -> MediaRecorder      (opus @ 64kbps)
 *
 * The noise floor is calibrated during the 3-2-1 countdown, as the 20th
 * percentile RMS of that window. Doing it there rather than from a fixed
 * constant is what makes pause detection work in a cafe as well as in a quiet
 * room, and the countdown is dead time anyway.
 */

import { FrameFeature } from "./analyzer";

export const MAX_MS = 30_000;
export const MIN_MS = 3_000;
export const COUNTDOWN_MS = 3_000;

export interface RecorderEvents {
  onFrame?: (f: FrameFeature) => void;
  onLevel?: (rms0to1: number) => void;
  onCountdown?: (secondsLeft: number) => void;
  onStart?: () => void;
  onTick?: (elapsedMs: number) => void;
  onStop?: (result: RecordingResult) => void;
  onError?: (e: Error) => void;
}

export interface RecordingResult {
  frames: FrameFeature[];
  noiseFloorDb: number;
  blob: Blob | null;
  durationMs: number;
  mimeType: string;
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private media: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  private frames: FrameFeature[] = [];
  private calib: number[] = [];
  private phase: "idle" | "calibrating" | "recording" | "stopped" = "idle";
  private startedAt = 0;
  private noiseFloorDb = -55;
  private timer: number | null = null;

  constructor(private events: RecorderEvents = {}) {}

  get state() { return this.phase; }
  get elapsedMs() { return this.phase === "recording" ? performance.now() - this.startedAt : 0; }
  /** The floor measured during the countdown. The live pass needs it to detect
   *  pauses against the room the user is actually in. */
  get noiseFloor() { return this.noiseFloorDb; }

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // The features are the product. Browser DSP would flatten exactly the
          // dynamics the mapping reads: AGC erases the RMS contour that becomes
          // stroke length and the passages of light, and noise suppression eats
          // the quiet passages that become open canvas.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (e) {
      this.events.onError?.(e instanceof Error ? e : new Error("microphone denied"));
      return;
    }

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume();
    await this.ctx.audioWorklet.addModule("/worklet/features.worklet.js");

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "feature-processor");
    this.node.port.onmessage = (e) => this.onFrame(e.data as FrameFeature);
    this.source.connect(this.node);
    // The worklet produces no output; connecting it to the destination would
    // feed the microphone back to the speakers.

    this.phase = "calibrating";
    let left = COUNTDOWN_MS / 1000;
    this.events.onCountdown?.(left);
    const countdown = window.setInterval(() => {
      left -= 1;
      if (left > 0) {
        this.events.onCountdown?.(left);
      } else {
        window.clearInterval(countdown);
        this.beginRecording();
      }
    }, 1000);
  }

  private beginRecording(): void {
    if (!this.stream || !this.ctx) return;

    // 20th percentile of the countdown window. The mean would be dragged up by
    // any throat-clear or chair creak in those three seconds; a low percentile
    // is what the room actually sounds like.
    if (this.calib.length > 4) {
      const s = [...this.calib].sort((a, b) => a - b);
      this.noiseFloorDb = s[Math.floor(s.length * 0.2)];
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
    try {
      this.media = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
      this.media.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      this.media.start();
    } catch {
      this.media = null; // features still work; the share just carries no audio
    }

    this.frames = [];
    this.startedAt = performance.now();
    this.phase = "recording";
    this.events.onStart?.();

    this.timer = window.setInterval(() => {
      const el = this.elapsedMs;
      this.events.onTick?.(el);
      if (el >= MAX_MS) this.stop();
    }, 50);
  }

  private onFrame(f: FrameFeature): void {
    if (this.phase === "calibrating") {
      this.calib.push(f.rmsDb);
      this.events.onLevel?.(levelOf(f.rmsDb));
      return;
    }
    if (this.phase !== "recording") return;
    // Re-base the timestamp onto the recording, not onto the audio context,
    // which has been running since the countdown began.
    const t = this.frames.length === 0 ? 0 : f.t - this.firstT;
    if (this.frames.length === 0) this.firstT = f.t;
    const frame: FrameFeature = { ...f, t: this.frames.length === 0 ? 0 : t };
    this.frames.push(frame);
    this.events.onFrame?.(frame);
    this.events.onLevel?.(levelOf(f.rmsDb));
  }
  private firstT = 0;

  async stop(): Promise<RecordingResult> {
    if (this.phase === "stopped") return this.result(null);
    const durationMs = this.elapsedMs;
    this.phase = "stopped";
    if (this.timer) window.clearInterval(this.timer);

    let blob: Blob | null = null;
    if (this.media && this.media.state !== "inactive") {
      blob = await new Promise<Blob | null>((resolve) => {
        const mr = this.media!;
        mr.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: mr.mimeType }) : null);
        mr.stop();
      });
    }

    this.teardown();
    const res = this.result(blob, durationMs);
    this.events.onStop?.(res);
    return res;
  }

  private result(blob: Blob | null, durationMs = 0): RecordingResult {
    return {
      frames: this.frames,
      noiseFloorDb: this.noiseFloorDb,
      blob,
      durationMs: durationMs || (this.frames.length ? this.frames[this.frames.length - 1].t * 1000 : 0),
      mimeType: this.media?.mimeType ?? "",
    };
  }

  private teardown(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.node = null; this.source = null; this.stream = null; this.ctx = null;
  }
}

/** dB -> a 0-1 level for the meter. Not a feature; display only. */
export function levelOf(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 55));
}
