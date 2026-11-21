import React from 'react';
import { IconPhonePair, IconSonarWave } from './BrandAndIcons';

interface Props {
  sonarArmed: boolean;
  benchmarkTrialsCount: number;
  onOpenConsole: () => void;
  onArmAndOpenConsole: () => void;
  onOpenCaregiver: () => void;
  onOpenBenchmark: () => void;
}

export const SaasOverview: React.FC<Props> = ({
  sonarArmed,
  benchmarkTrialsCount,
  onOpenConsole,
  onArmAndOpenConsole,
  onOpenCaregiver,
  onOpenBenchmark,
}) => {
  return (
    <div>
      {/* 1. Quiet Editorial Engineering Hero (ibelick/ui-skills DESIGN.md) */}
      <section className="ui-hero">
        <div className="ui-container">
          <div className="ui-kicker">
            <span className={`led ${sonarArmed ? 'on-teal' : ''}`} />
            <span>
              {sonarArmed ? '20 kHz sonar active' : 'Zero-camera ultrasonic elder safety'} ·
              Alappuzha houseboat build
            </span>
          </div>

          <h1>
            Check on parents living alone in Kerala, without putting a camera in their bedroom.
          </h1>

          <p className="ui-hero-lead">
            Kaaval turns a bedside laptop or tablet into an inaudible 17.60–20.25 kHz stereo
            ultrasonic sensor. It tracks room occupancy, chest respiration, and sudden falls with
            the optical camera strictly off—opening a spoken Malayalam check-in only after a
            verified fall + 4.0s stillness.
          </p>

          <div className="ui-hero-actions">
            <button
              type="button"
              className="ui-btn-primary ui-btn-lg"
              onClick={sonarArmed ? onOpenConsole : onArmAndOpenConsole}
            >
              <IconSonarWave size={16} />
              {sonarArmed ? 'Open live room console' : 'Arm sonar & open console'}
            </button>

            <button
              type="button"
              className="ui-btn-lg"
              onClick={onOpenCaregiver}
            >
              <IconPhonePair size={16} />
              Open caregiver phone app
            </button>

            <button
              type="button"
              className="ui-btn-lg"
              onClick={onOpenBenchmark}
            >
              4×4 benchmark ({benchmarkTrialsCount})
            </button>
          </div>

          {/* 4-Card Verified Specification Grid (Identifier -> Description -> Source) */}
          <div className="ui-spec-strip">
            <article className="ui-spec-card">
              <div className="ui-spec-val">0 px</div>
              <div className="ui-spec-title">Hardware camera strictly off</div>
              <p className="ui-spec-desc">
                Uses WebAudio stereo speakers and microphone above 17.6 kHz only. The MacBook
                camera indicator LED never turns on.
              </p>
              <div className="ui-spec-source">AudioWorklet · zero video API</div>
            </article>

            <article className="ui-spec-card">
              <div className="ui-spec-val">-115.1 dB</div>
              <div className="ui-spec-title">Audio-thread speech firewall</div>
              <p className="ui-spec-desc">
                All frequencies below 17.5 kHz are zeroed inside the DSP thread before leaving the
                worklet. Everyday speech is never recorded.
              </p>
              <div className="ui-spec-source">verify-physics.mjs · Suite 02</div>
            </article>

            <article className="ui-spec-card">
              <div className="ui-spec-val">0.33 cm</div>
              <div className="ui-spec-title">Stereo FDMA range &amp; vitals</div>
              <p className="ui-spec-desc">
                Hann-windowed FMCW pulse compression + OS-CFAR resolve 1–3 people (0.32–3.0m) and
                demodulate chest respiration BPM.
              </p>
              <div className="ui-spec-source">verify-physics.mjs · Suites 01, 03, 06</div>
            </article>

            <article className="ui-spec-card">
              <div className="ui-spec-val">4 models</div>
              <div className="ui-spec-title">Consent-gated Malayalam triage</div>
              <p className="ui-spec-desc">
                Bulbul v3 prompts in Malayalam, Saaras v4 transcribes, Sarvam-105B filters false
                alarms, and family reply to the room speaker.
              </p>
              <div className="ui-spec-source">server/sarvam.ts · 0-credit lock ready</div>
            </article>
          </div>
        </div>
      </section>

      {/* 2. Problem Context & Acoustic Mechanism Split */}
      <section className="ui-section">
        <div className="ui-container ui-split-grid">
          <div>
            <div className="ui-sec-head" style={{ marginBottom: 16 }}>
              <h2>Designed for Kerala&apos;s elder-care reality</h2>
              <p>
                Kerala has India&apos;s highest elderly share (16.5% today, projected 22.8% by
                2036, UNFPA) while 2.2 million Keralites work abroad or out of state (Kerala
                Migration Survey).
              </p>
            </div>

            <p style={{ fontSize: 14, color: 'var(--content-secondary)' }}>
              Parents living alone refuse indoor bedroom cameras, and wearable fall pendants are
              frequently left on bedside tables at night. Kaaval runs on an existing bedside
              laptop or tablet browser with zero extra hardware.
            </p>

            <ul className="ui-bullet-list">
              <li>Tracks presence and breathing locally without cloud video or audio streaming</li>
              <li>Verifies anomalies in spoken Malayalam before waking family abroad</li>
              <li>Bridges English, Hindi, or Malayalam replies back to Amma&apos;s room speaker</li>
            </ul>
          </div>

          <div className="ui-feature-stack">
            <article className="ui-feature-item">
              <h3>Detects people already seated at boot</h3>
              <p>
                A 0.60-second (14-frame) complex IQ delay-line canceller paired with 45th-percentile
                OS-CFAR isolates involuntary posture sway and chest breathing while rejecting 4.5×
                louder static wooden walls.
              </p>
            </article>

            <article className="ui-feature-item">
              <h3>Separates walking past from real falls</h3>
              <p>
                High motion impulse opens a 4.0-second post-impact watch window. Continuous
                footsteps cancel silently; sustained post-spike stillness triggers a gentle
                Malayalam voice check-in.
              </p>
            </article>

            <article className="ui-feature-item">
              <h3>Optional 3-band FDMA blind-spot satellite</h3>
              <p>
                Pair an Android phone on `/satellite` (17.60–18.42 kHz) behind the laptop while
                the host shifts automatically to 18.58–20.34 kHz—covering front and backside zones
                with zero cross-node ghosting.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* 3. End-to-End Pipeline & Consent Architecture */}
      <section className="ui-section">
        <div className="ui-container">
          <div className="ui-sec-head">
            <h2>End-to-end fall verification flow</h2>
            <p>
              Calm nights stay 100% local in the browser; cloud models run strictly inside the
              9.5-second post-anomaly consent window.
            </p>
          </div>

          <ol className="ui-steps-grid">
            <li className="ui-step-card">
              <span className="ui-step-idx">01 · SONAR</span>
              <h3>Sweep stereo chirps</h3>
              <p>
                Left (17.6–18.85 kHz) and right (19.0–20.25 kHz) channels sweep 42.6 ms chirps
                while zeroing all audio below 17.5 kHz.
              </p>
            </li>

            <li className="ui-step-card">
              <span className="ui-step-idx">02 · KINEMATICS</span>
              <h3>Verify 4.0s stillness</h3>
              <p>
                Motion spikes trigger a 4.0-second recovery timer so dropping an object or walking
                across the room never nags the resident.
              </p>
            </li>

            <li className="ui-step-card">
              <span className="ui-step-idx">03 · PROMPT</span>
              <h3>Check in gently</h3>
              <p>
                Ultrasound pauses cleanly and Bulbul v3 plays a natural Malayalam prompt asking
                Amma if she needs help.
              </p>
            </li>

            <li className="ui-step-card">
              <span className="ui-step-idx">04 · TRIAGE</span>
              <h3>Classify response</h3>
              <p>
                Saaras v4 streams 16 kHz speech; Sarvam-105B + Translate classify SAFE vs.
                EMERGENCY in parallel and re-lock the firewall.
              </p>
            </li>

            <li className="ui-step-card">
              <span className="ui-step-idx">05 · DISPATCH</span>
              <h3>Alert &amp; speak back</h3>
              <p>
                SAFE responses stay local. Emergencies push an anonymized Sonic Ironbow card to
                `/caregiver` with 2-way voice reassurance.
              </p>
            </li>
          </ol>

          <div className="ui-arch-card">
            <div>
              <h3 style={{ fontSize: 18 }}>Sarvam AI execution path</h3>
              <p style={{ color: 'var(--content-secondary)', marginTop: 6, fontSize: 14 }}>
                During development and acoustic calibration, Credit Guard locks cloud calls to 0
                using pre-cached Malayalam prompts and deterministic local triage.
              </p>

              <ul className="ui-chain">
                <li>
                  <span>OS-CFAR fall + stillness</span> →
                </li>
                <li>
                  <span>bulbul:v3 (ml-IN)</span> →
                </li>
                <li>
                  <span>saaras:v4 WS</span> →
                </li>
                <li>
                  <span>sarvam-105b-conversations</span> →
                </li>
                <li className="is-accent">
                  <span>/ws/hub caregiver bridge</span>
                </li>
              </ul>
            </div>

            <div className="ui-boundary-pair">
              <div className="ui-boundary-box">
                <h4>Stays local in the room</h4>
                <p>
                  0 optical pixels, &lt;17.5 kHz everyday speech (zeroed in DSP), and false alarms
                  dismissed when Amma confirms she is alright.
                </p>
              </div>
              <div className="ui-boundary-box">
                <h4>Sent on verified emergency</h4>
                <p>
                  Range &amp; respiration BPM, anonymized Sonic Ironbow echo silhouette, Malayalam
                  + English summary, and live room speaker bridge.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Physical Boundaries & Setup FAQ */}
      <section className="ui-section">
        <div className="ui-container">
          <div className="ui-sec-head">
            <h2>Physical boundaries &amp; setup</h2>
            <p>
              Real acoustic constraints so you know what hardware setup 18–20 kHz sonar expects.
            </p>
          </div>

          <div className="ui-faq-grid">
            <details open>
              <summary>Does it detect someone who is already sitting still at startup?</summary>
              <p>
                Yes. Static clutter subtraction alone erases a seated person, so Kaaval combines a
                0.60-second complex IQ delay line with OS-CFAR to lock onto involuntary posture
                micro-sway and chest respiration across 0.32–3.0 meters.
              </p>
            </details>

            <details open>
              <summary>How does Sonic Ironbow render a thermal-style view with no camera?</summary>
              <p>
                Sonic Ironbow maps real 2D ultrasonic range-azimuth echo energy and chest
                micro-Doppler onto a scientific Ironbow lookup table. Cover your webcam physically
                and verify that tracking works identically.
              </p>
            </details>

            <details>
              <summary>Why must Bluetooth AirPods or headsets be disconnected?</summary>
              <p>
                Bluetooth Hands-Free Profile resamples microphone audio to 8–16 kHz, filtering out
                17.6–20.25 kHz ultrasound. Always use the laptop&apos;s built-in stereo speakers
                and microphone at 48 kHz.
              </p>
            </details>

            <details>
              <summary>Does ultrasound pass through closed wooden or concrete walls?</summary>
              <p>
                No. High-frequency 19 kHz acoustic waves reflect off solid doors and walls, making
                Kaaval strictly a single-room sensor with hard physical privacy boundaries.
              </p>
            </details>
          </div>
        </div>
      </section>
    </div>
  );
};
