import type { NextConfig } from "next";

const config: NextConfig = {
  // The AudioWorklet and the lexicon are served as static assets from /public,
  // so nothing here needs a custom loader. Long-cache the immutable artifact.
  async headers() {
    return [
      {
        source: "/lexicon.bin",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/worklet/features.worklet.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default config;
