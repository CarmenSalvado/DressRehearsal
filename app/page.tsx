const looks = [
  ["01", "Silver Headliner"],
  ["02", "Crimson Entrance"],
  ["03", "Midnight Icon"],
];

export default function Home() {
  return (
    <main className="landing">
      <div className="stage-image" aria-hidden="true">
        <div className="stage-scene">
          <span className="dress dress-silver" />
          <span className="dress dress-crimson" />
          <span className="dress dress-midnight" />
        </div>
      </div>
      <div className="stage-glow" aria-hidden="true" />
      <div className="curtain curtain-left" aria-hidden="true" />
      <div className="curtain curtain-right" aria-hidden="true" />

      <header className="masthead enter enter-1">
        <a className="wordmark" href="/" aria-label="Dress Rehearsal home">
          <span className="monogram" aria-hidden="true">DR</span>
          <span>Dress Rehearsal</span>
        </a>
        <span className="stage-label">
          <span aria-hidden="true" /> Main Stage
        </span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow enter enter-2">
          Virtual costume casting <span aria-hidden="true">·</span> YouCam Apparel VTO
        </p>
        <h1 id="hero-title" className="enter enter-3">
          Who are you
          <em>tonight?</em>
        </h1>
        <p className="hero-copy enter enter-4">
          Audition three real statement looks on yourself. Choose the one worth meeting
          under the fitting-room lights.
        </p>
        <div className="hero-action enter enter-5">
          <a className="primary-action" href="/cast">
            <span>Begin casting</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </a>
          <p>
            One photo. Three garments.
            <br />A visual preview—not fit advice.
          </p>
        </div>
      </section>

      <aside className="look-index enter enter-5" aria-label="Tonight's looks">
        <p>Tonight&apos;s cast</p>
        <ol>
          {looks.map(([number, name]) => (
            <li key={number}>
              <span>{number}</span> {name}
            </li>
          ))}
        </ol>
      </aside>

      <p className="edition enter enter-4" aria-label="Private preview, 2026">
        Private preview <span aria-hidden="true">/</span> 2026
      </p>

      <footer className="footer enter enter-5">
        <p>© Dress Rehearsal</p>
        <div className="footer-links">
          <details className="info">
            <summary>Privacy</summary>
            <div className="info-panel">
              <strong>Your photograph stays yours.</strong>
              <p>
                Perfect Corp processes uploaded photos to create previews. This application
                does not retain the original after upload completes.
              </p>
            </div>
          </details>
          <details className="info">
            <summary>Technical receipt</summary>
            <div className="info-panel receipt-panel">
              <strong>Every result carries proof.</strong>
              <p>
                Casting results are persistently labeled LIVE, RECORDED LIVE RUN or FAILED.
                This landing artwork is editorial, not a VTO result.
              </p>
            </div>
          </details>
        </div>
      </footer>
    </main>
  );
}
