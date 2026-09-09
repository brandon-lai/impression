import { Studio } from "@/components/Studio";
import { promptFor, todayKey } from "@/lib/prompts";
import Link from "next/link";

// The prompt is resolved on the server so the first paint carries it. It is a
// pure function of the date, so this costs nothing and cannot disagree with
// what the client would compute.
export default function Home() {
  const prompt = promptFor(todayKey());
  return (
    <>
      <Studio prompt={prompt} />
      <footer style={{ maxWidth: 1000, margin: "0 auto", padding: "0 clamp(16px,3vw,32px) 32px" }}>
        <nav className="nav">
          <Link href="/gallery">Today&apos;s gallery</Link>
          <Link href="/harness">Renderer harness</Link>
        </nav>
      </footer>
    </>
  );
}
