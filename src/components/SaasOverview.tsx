import React from 'react';
import {
  HeroCloudsDivider,
  IconPhonePair,
  IconSonarWave,
  KaavalHeroWordmark,
} from './BrandAndIcons';

interface Props {
  sonarArmed: boolean;
  benchmarkTrialsCount: number;
  onOpenConsole: () => void;
  onArmAndOpenConsole: () => void;
  onOpenCaregiver: () => void;
  onOpenBenchmark: () => void;
  onOpenSatellite?: () => void;
}

const TICKER_ITEMS = [
  '0 PX OPTICAL CAMERA',
  '17.60–20.25 KHZ STEREO FDMA SONAR',
  '-115.1 DB SPEECH FIREWALL (<17.5 KHZ ZEROED)',
  '0.33 CM FMCW RANGE PRECISION',
  '9/9 VERIFIED PHYSICS SUITES',
  'BULBUL V3 + SAARAS V4 + SARVAM-105B',
  '2-WAY MALAYALAM CAREGIVER VOICE BRIDGE',
];

export const SaasOverview: React.FC<Props> = ({
  sonarArmed,
  benchmarkTrialsCount,
  onOpenConsole,
  onArmAndOpenConsole,
  onOpenCaregiver,
  onOpenBenchmark,
  onOpenSatellite,
}) => {
  return (
    <div>
      {/* 1. Electric Cobalt Hero (#2958D4) + Scalloped #FFF4C1 Cloud Divider */}
      <section className="gx-hero">
        <div className="gx-hero-inner">
          <div className="gx-eyebrow-pill">
            <span className={`led ${sonarArmed ? 'on-teal' : 'on-amber'}`} />
            <span>Zero-camera elder safety · Alappuzha houseboat build</span>
          </div>

          <KaavalHeroWordmark />

          <h1>
            Check on parents living alone in Kerala, without putting a camera in their bedroom.
          </h1>

          <p className="gx-hero-sub">
            Kaaval turns a bedside laptop or tablet into an inaudible 17.6–20.2 kHz ultrasonic
            room sensor. It tracks presence, breathing, and falls with the camera strictly off—and
            only opens a spoken Malayalam check-in when a real fall + stillness occurs.
          </p>

          <div className="gx-hero-ctas">
            <button
              type="button"
              className="gx-cta-btn gx-cta-big"
              onClick={sonarArmed ? onOpenConsole : onArmAndOpenConsole}
            >
              <IconSonarWave size={18} />
              {sonarArmed ? 'Open live room console' : 'Arm sonar & open console'}
            </button>

            <button
              type="button"
              className="gx-cta-sec"
              onClick={onOpenCaregiver}
            >
              <IconPhonePair size={18} />
              Open caregiver phone app
            </button>
          </div>
        </div>

        <HeroCloudsDivider fill="#FFF4C1" />
      </section>

      {/* 2. Signature -1.6deg Acid-Lime Ticker Tape */}
      <div className="gx-ticker" aria-label="Verified acoustic specifications">
        <div className="gx-ticker-track">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, idx) => (
            <span key={idx}>★ {item}</span>
          ))}
        </div>
      </div>

      {/* 3. Warm Cream (#FFF4C1) Product Modules Strip (Matches GrowthX Offcampus `_cities` band!) */}
      <section className="gx-section gx-cream-band">
        <div className="gx-container">
          <div className="gx-sec-head">
            <h2 className="gx-sec-title">Explore the live platform</h2>
            <p className="gx-sec-lead">
              Four synchronized views running locally over WebAudio and WebSockets—zero extra
              hardware required.
            </p>
          </div>

          <div className="gx-modules-grid">
            <article className="gx-module-card">
              <div className="gx-module-swatch" style={{ background: 'var(--yellow)' }}>
                <span>01 · PRIMARY SENSOR</span>
                <span>17.6–20.2 kHz</span>
              </div>
              <h3>Sonic Ironbow console</h3>
              <p>
                Live OS-CFAR multi-person ultrasonic heatmap, chest phase wave, and &lt;17.5 kHz
                speech firewall scope.
              </p>
              <button
                type="button"
                className="btn-arm"
                onClick={sonarArmed ? onOpenConsole : onArmAndOpenConsole}
              >
                {sonarArmed ? 'Open console' : 'Launch & arm sonar'}
              </button>
            </article>

            <article className="gx-module-card">
              <div className="gx-module-swatch" style={{ background: 'var(--green)' }}>
                <span>02 · EVALUATION</span>
                <span>4×4 MATRIX</span>
              </div>
              <h3>Cabin benchmark</h3>
              <p>
                Record 5-second ground-truth trials across empty cabin, seated breathing, walking,
                and fall + stillness.
              </p>
              <button type="button" onClick={onOpenBenchmark}>
                Open benchmark ({benchmarkTrialsCount})
              </button>
            </article>

            <article className="gx-module-card">
              <div className="gx-module-swatch" style={{ background: 'var(--lilac)' }}>
                <span>03 · FAMILY PHONE</span>
                <span>EN/HI → ML</span>
              </div>
              <h3>Caregiver companion</h3>
              <p>
                Receives verified fall alerts over Wi-Fi hotspot and speaks natural Malayalam back
                into Amma&apos;s room speaker.
              </p>
              <button type="button" onClick={onOpenCaregiver}>
                Open caregiver app
              </button>
            </article>

            <article className="gx-module-card">
              <div className="gx-module-swatch" style={{ background: 'var(--pink)' }}>
                <span>04 · NODE B MESH</span>
                <span>17.6–18.4 kHz</span>
              </div>
              <h3>Backside satellite</h3>
              <p>
                Turn an Android phone on HTTPS into an orthogonal mono ultrasonic sensor guarding
                the blind spot behind the laptop.
              </p>
              <button type="button" onClick={onOpenSatellite || onOpenConsole}>
                Open satellite node
              </button>
            </article>
          </div>
        </div>
      </section>

      {/* 4. Deep Plum-Night (#21182D) Tilted Proof Deck (Exact Offcampus `_what` + `_pcard` match!) */}
      <section className="gx-section gx-night-band">
        <div className="gx-container">
          <div className="gx-sec-head">
            <h2 className="gx-sec-title">Verified physics, not black-box claims.</h2>
            <p className="gx-sec-lead">
              Every metric below is validated continuously in our 9-suite deterministic
              AudioWorklet benchmark across 48 kHz stereo channels.
            </p>
          </div>

          <div className="gx-deck">
            <article
              className="gx-pcard"
              style={{ background: 'var(--yellow)', transform: 'rotate(-1.2deg)' }}
            >
              <div className="gx-big-num">0 px</div>
              <h3>Hardware camera off</h3>
              <p>
                Uses WebAudio speakers and mic above 17.6 kHz only. The MacBook green camera LED
                never turns on—preserving bedroom dignity.
              </p>
            </article>

            <article
              className="gx-pcard"
              style={{ background: 'var(--green)', transform: 'rotate(1deg)' }}
            >
              <div className="gx-big-num">-115 dB</div>
              <h3>Audio-thread speech firewall</h3>
              <p>
                Every sample below 17.5 kHz is mathematically zeroed inside the DSP thread before
                leaving the worklet. Everyday speech is never recorded.
              </p>
            </article>

            <article
              className="gx-pcard"
              style={{ background: 'var(--lilac)', transform: 'rotate(-0.8deg)' }}
            >
              <div className="gx-big-num">0.3 cm</div>
              <h3>Stereo FDMA range &amp; vitals</h3>
              <p>
                Orthogonal left/right chirps + OS-CFAR resolve 1–3 people (0.32–3.0m), suppress
                2×R mirror ghosts, and track chest respiration BPM.
              </p>
            </article>

            <article
              className="gx-pcard"
              style={{ background: 'var(--pink)', transform: 'rotate(1.2deg)' }}
            >
              <div className="gx-big-num">9/9</div>
              <h3>Malayalam triage &amp; DSP suites</h3>
              <p>
                Bulbul v3 checks on Amma in Malayalam, Saaras v4 transcribes, Sarvam-105B filters
                false alarms, and family reply to her room speaker.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* 5. Electric Cobalt (#2958D4) Problem vs. Mechanism Split (`_about` + `_room`) */}
      <section className="gx-section gx-blue-band">
        <div className="gx-container gx-about-grid">
          <div>
            <span className="gx-tag-pill">Why Kaaval exists</span>
            <h2
              className="gx-sec-title"
              style={{ color: 'var(--cream)', marginTop: 14 }}
            >
              Kerala&apos;s elder-care gap cannot be solved with bedroom surveillance.
            </h2>
            <p style={{ fontSize: 16.5, color: '#e6ecff', marginTop: 12, maxWidth: '48ch' }}>
              Kerala has India&apos;s highest elderly share (16.5% today, projected 22.8% by 2036,
              UNFPA) while 2.2 million Keralites work outside the state or abroad (KMS).
            </p>
            <p className="gx-strike-line">
              Not a <s>bedroom CCTV camera</s>, an <s>unworn wrist pendant</s>, or{' '}
              <s>3 a.m. false-alarm spam</s>.
            </p>

            <ul className="gx-glass-list">
              <li>Runs on any bedside laptop or tablet browser with zero extra hardware</li>
              <li>Separates normal room walking from sudden impact + 4.0s stillness</li>
              <li>Speaks natural Malayalam before ever waking family abroad</li>
            </ul>
          </div>

          <div className="gx-beats">
            <div className="gx-beat" style={{ background: 'var(--yellow)' }}>
              <h3>Detects even if already seated at boot</h3>
              <p>
                A 0.60-second (14-frame) complex IQ delay-line canceller + Hann-windowed OS-CFAR
                isolates human micro-sway and chest breathing from 4.5× louder wooden cabin walls.
              </p>
            </div>

            <div className="gx-beat" style={{ background: 'var(--green)' }}>
              <h3>Filters false alarms in spoken Malayalam</h3>
              <p>
                If Amma drops a book and replies &ldquo;കുഴപ്പമില്ല മോനേ&rdquo;, Sarvam-105B marks
                the event safe locally and immediately re-locks the &lt;17.5 kHz speech firewall.
              </p>
            </div>

            <div className="gx-beat" style={{ background: 'var(--pink)' }}>
              <h3>Two-way reassurance on any hotspot</h3>
              <p>
                If Amma needs help or stays silent, caregivers get an anonymized Sonic Ironbow
                posture card on their phone and speak back into her room in natural Malayalam.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Cream2 (#F9EECF) 5-Step Pipeline + Concentric White Verification Card */}
      <section className="gx-section gx-cream2-band">
        <div className="gx-container">
          <div className="gx-sec-head">
            <h2 className="gx-sec-title">How a fall check-in works end to end</h2>
            <p className="gx-sec-lead">
              Calm nights stay 100% private and local, while genuine emergencies reach family in
              seconds with full context.
            </p>
          </div>

          <ol className="gx-steps">
            <li className="gx-step">
              <div className="gx-step-num">1</div>
              <h3>Transmit stereo chirps</h3>
              <p>
                Left (17.6–18.85 kHz) and right (19.0–20.25 kHz) speakers sweep 42.6 ms chirps
                while zeroing all speech frequencies below 17.5 kHz.
              </p>
            </li>

            <li className="gx-step">
              <div className="gx-step-num">2</div>
              <h3>Verify 4.0s stillness</h3>
              <p>
                When motion impulse crosses threshold, Kaaval watches for 4.0 seconds of
                post-impact stillness so dropping a book never nags the room.
              </p>
            </li>

            <li className="gx-step">
              <div className="gx-step-num">3</div>
              <h3>Ask gently in Malayalam</h3>
              <p>
                Ultrasound pauses cleanly and Bulbul v3 plays a natural Malayalam check-in asking
                Amma if she is alright, opening a 9.5-second consent window.
              </p>
            </li>

            <li className="gx-step">
              <div className="gx-step-num">4</div>
              <h3>Transcribe &amp; triage</h3>
              <p>
                Saaras v4 streams live Malayalam speech; Sarvam-105B + Translate classify SAFE vs.
                EMERGENCY in parallel (~1.2s) and re-lock the firewall.
              </p>
            </li>

            <li className="gx-step">
              <div className="gx-step-num">5</div>
              <h3>Alert &amp; speak back</h3>
              <p>
                SAFE replies stay local. Emergencies push a live alert to `/caregiver`, letting
                family type in English/Hindi/Malayalam to speak in the room.
              </p>
            </li>
          </ol>

          <div className="gx-verify-card">
            <div>
              <span className="gx-tag-pill">Consent-gated Sarvam AI stack</span>
              <h3 style={{ fontSize: 25, fontWeight: 800, marginTop: 12 }}>
                Four Indian-language models orchestrated only after physical verification
              </h3>
              <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 15 }}>
                Zero background cloud streaming. API calls fire strictly during the 9.5-second
                post-anomaly verification window—or run in 0-credit rehearsal lock while testing.
              </p>

              <ul className="gx-path-pills">
                <li>
                  <span>OS-CFAR Fall + Stillness</span> →
                </li>
                <li>
                  <span>bulbul:v3 (ml-IN)</span> →
                </li>
                <li>
                  <span>saaras:v4 16kHz WS</span> →
                </li>
                <li>
                  <span>sarvam-105b-conversations</span> →
                </li>
                <li className="highlight">
                  <span>Caregiver Phone Bridge</span>
                </li>
              </ul>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 22 }}>
                <button
                  type="button"
                  className="btn-arm"
                  onClick={onOpenConsole}
                >
                  Inspect live acoustic scopes
                </button>
                <button type="button" onClick={onOpenBenchmark}>
                  Run 4×4 cabin benchmark ({benchmarkTrialsCount} trials)
                </button>
              </div>
            </div>

            <div className="gx-fact-stack">
              <div className="gx-fact-box">
                <h4>What never leaves the room</h4>
                <p style={{ fontSize: 14, color: 'var(--ink)' }}>
                  Optical video (0 pixels), everyday conversation (&lt;17.5 kHz zeroed in DSP), and
                  auto-dismissed false alarms when Amma confirms she is fine.
                </p>
              </div>

              <div className="gx-fact-box lime">
                <h4>What reaches the caregiver phone</h4>
                <p style={{ fontSize: 14, color: 'var(--ink)' }}>
                  Room range &amp; respiration BPM, anonymized Sonic Ironbow echo silhouette,
                  Malayalam + English clinical summary, and instant 2-way voice reassurance.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Warm Cream (#FFF4C1) 2-Column Engineering FAQ (`align-items: start`!) */}
      <section className="gx-section gx-cream-band">
        <div className="gx-container">
          <div className="gx-sec-head">
            <h2 className="gx-sec-title">Physical boundaries &amp; setup questions</h2>
            <p className="gx-sec-lead">
              Clear acoustic constraints so you know exactly where Kaaval excels and what hardware
              setup it expects.
            </p>
          </div>

          <div className="gx-faq-grid">
            <details open>
              <summary>Does it work if someone is already sitting still when I arm sonar?</summary>
              <p>
                Yes. Unlike naive background subtraction that erases seated people into static
                clutter, Kaaval uses a 0.60-second complex IQ delay line + OS-CFAR to pick up
                involuntary human posture micro-sway and chest breathing within 0.32–3.0 meters.
              </p>
            </details>

            <details open>
              <summary>Why is the Sonic Ironbow image warm-colored without using a camera?</summary>
              <p>
                Sonic Ironbow maps real 2D ultrasonic range-azimuth echo strength and chest
                micro-Doppler onto a scientific Ironbow palette. Your webcam stays completely
                untouched—cover the lens with tape and watch it track you identically.
              </p>
            </details>

            <details>
              <summary>Can I use Bluetooth AirPods or a phone speaker across closed doors?</summary>
              <p>
                No—unplug Bluetooth headsets and use the laptop&apos;s built-in stereo speakers and
                mic. Bluetooth Hands-Free Profile resamples audio to 8–16 kHz (cutting off 18 kHz
                ultrasound), and 19 kHz sound waves reflect off closed doors rather than passing
                through walls.
              </p>
            </details>

            <details>
              <summary>How does 0-credit lock protect Sarvam API credits during setup?</summary>
              <p>
                While tuning sonar gain or testing cabin echoes, Credit Guard serves pre-cached
                Bulbul v3 Malayalam prompts from disk and deterministic local triage (0 API calls).
                Toggle to Sarvam Live in the console header whenever you want full cloud inference.
              </p>
            </details>
          </div>
        </div>
      </section>
    </div>
  );
};
