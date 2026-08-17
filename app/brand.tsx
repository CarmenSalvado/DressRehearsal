import Link from "next/link";

export function Brand() {
  return (
    <Link className="wordmark" href="/" aria-label="Dress Rehearsal home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 112 128">
          <path d="M55 30c8-3 12-8 12-14 0-7-5-12-12-12S43 9 43 16" />
          <path d="M55 30 14 51l1 37c0 15-4 28-10 38" />
          <path d="m55 30 43 22c-4 17-15 28-31 31" />
          <path d="M15 52c22 29 41 50 82 51" />
        </svg>
      </span>
      <span className="brand-name">dress rehearsal</span>
    </Link>
  );
}
