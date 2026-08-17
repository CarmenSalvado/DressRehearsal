import { Brand } from "./brand";

const looks = [
  { name: "Power Balance Suit", note: "Calm structure. Quiet confidence.", image: "/images/style-quiz-tailored.png" },
  { name: "Soft Drape Dress", note: "Fluid movement. Effortless ease.", image: "/images/style-quiz-fluid.png" },
  { name: "Sculpted Evening", note: "Modern silhouette. Memorable impact.", image: "/images/style-quiz-cobalt.png" },
  { name: "Denim Utility", note: "Purposeful design. Everyday strength.", image: "/images/style-quiz-denim.png" },
];

export default function Home() {
  return (
    <main className="landing">
      <header className="masthead landing-masthead enter enter-1">
        <Brand />
        <nav className="landing-nav" aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="/studio">For brands</a>
          <a className="landing-enter" href="/cast">Enter the fitting <span aria-hidden="true">→</span></a>
        </nav>
      </header>

      <section className="editorial-hero" aria-labelledby="hero-title">
        <div className="editorial-copy">
          <p className="landing-kicker enter enter-2">Unreleased fashion · real customer intent</p>
          <h1 id="hero-title" className="enter enter-3">
            Try it<br />before they<br />make it<span>.</span>
          </h1>
          <i className="coral-rule" aria-hidden="true" />
          <p className="hero-copy enter enter-4">
            See unreleased fashion on you.<br />Choose what feels right.<br />Then answer at the real target price.
          </p>
          <div className="hero-action enter enter-5">
            <a className="primary-action" href="/cast">
              Start your style edit <span aria-hidden="true">→</span>
            </a>
          </div>
          <div className="landing-principle">
            <span className="principle-icon" aria-hidden="true">
              <svg viewBox="0 0 32 42">
                <path d="M16 3v5m-4 0h8m-8 0c0 4-5 5-5 10 0 3 2 5 4 6L9 33h14l-2-9c2-1 4-3 4-6 0-5-5-6-5-10" />
                <path d="M16 33v5m-6 1h12" />
              </svg>
            </span>
            <p><strong>Taste first. Price second. Inventory last.</strong><span>Better signal for people. Less guesswork for brands.</span></p>
          </div>
        </div>

        <div className="editorial-rack enter enter-4" aria-label="A preview of the style edit">
          {looks.map((look, index) => (
            <figure key={look.name}>
              <img src={look.image} alt={look.name} />
              <figcaption><span>0{index + 1}</span><strong>{look.name}</strong><small>{look.note}</small></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="how-strip enter enter-5" id="how-it-works" aria-label="How Dress Rehearsal works">
        <p><span>01</span><strong>Discover your style</strong><small>A five-question edit built around real clothes.</small></p>
        <p><span>02</span><strong>Try three samples</strong><small>See each unreleased look on your own photo.</small></p>
        <p><span>03</span><strong>Make one honest choice</strong><small>Preference first; target price only after.</small></p>
      </section>

      <footer className="footer enter enter-5">
        <p>Dress Rehearsal · Better collections start with real customer choices.</p>
        <div className="footer-links">
          <details className="info">
            <summary>Photo privacy</summary>
            <div className="info-panel">
              <strong>Your photo stays yours.</strong>
              <p>Perfect Corp processes it to create previews. Dress Rehearsal does not retain the original after upload.</p>
            </div>
          </details>
          <details className="info">
            <summary>How the signal works</summary>
            <div className="info-panel">
              <strong>Taste first. Price second.</strong>
              <p>Your favorite is locked before the target price appears, so brands can distinguish attraction from buying intent.</p>
            </div>
          </details>
        </div>
      </footer>
    </main>
  );
}
