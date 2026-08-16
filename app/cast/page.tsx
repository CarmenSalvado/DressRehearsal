import Link from "next/link";

export default function CastPreview() {
  return (
    <main className="holding-page">
      <p className="eyebrow">Main Stage · Gate 0</p>
      <h1>The stage opens after provider proof.</h1>
      <p>
        The live casting room is intentionally locked until at least two verified
        YouCam cloth-v3 runs pass the quality gate.
      </p>
      <Link className="text-link" href="/">← Return to the foyer</Link>
    </main>
  );
}
