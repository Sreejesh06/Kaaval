import React, { useState } from 'react';

export type ArborRoute = 'OVERVIEW' | 'CONSOLE' | 'BENCHMARK' | 'CAREGIVER' | 'SATELLITE';

interface NavbarProps {
  activeRoute: ArborRoute;
  sonarArmed: boolean;
  onNavigate: (route: ArborRoute) => void;
  onPrimaryAction: () => void;
}

interface FooterProps {
  activeRoute: ArborRoute;
  sonarArmed: boolean;
  creditLocked: boolean;
  benchmarkTrialsCount: number;
  lanCaregiverUrl?: string;
  onNavigate: (route: ArborRoute) => void;
  onToggleCreditLock: () => void;
  onPrimaryAction: () => void;
}

const NAV_ITEMS: Array<{ id: ArborRoute; label: string }> = [
  { id: 'OVERVIEW', label: 'Overview' },
  { id: 'CONSOLE', label: 'Console' },
  { id: 'BENCHMARK', label: 'Benchmark' },
  { id: 'CAREGIVER', label: 'Caregiver' },
  { id: 'SATELLITE', label: 'Satellite' },
];

/**
 * Monochrome Kaaval Wordmark crafted to match Arbor's `.mast__mark` optical height (22px)
 * and monumental `.foot__mark` full-bleed vector geometry.
 */
const KaavalMastWordmark: React.FC = () => (
  <svg
    viewBox="0 0 212 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Acoustic wavefront glyph */}
    <path
      d="M4 8V24M4 16L12.5 8M6.8 13.5L14 24"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M17.5 11.5C19.8 14 19.8 18 17.5 20.5"
      stroke="#A7EF77"
      strokeWidth="2.3"
      strokeLinecap="round"
    />
    <path
      d="M21.8 8.5C25.5 12.6 25.5 19.4 21.8 23.5"
      stroke="currentColor"
      strokeOpacity="0.72"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
    {/* Crisp geometric wordmark */}
    <text
      x="32"
      y="23"
      fill="currentColor"
      fontFamily="'Bricolage Grotesque', sans-serif"
      fontWeight="800"
      fontSize="22"
      letterSpacing="-0.6"
    >
      kaaval
    </text>
    <text
      x="108"
      y="21.5"
      fill="currentColor"
      fillOpacity="0.62"
      fontFamily="'Noto Sans Malayalam', sans-serif"
      fontWeight="600"
      fontSize="12.5"
    >
      കാവൽ
    </text>
  </svg>
);

const KaavalMonumentWordmark: React.FC = () => (
  <svg
    viewBox="0 0 760 122"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <text
      x="380"
      y="108"
      textAnchor="middle"
      fill="currentColor"
      fontFamily="'Bricolage Grotesque', sans-serif"
      fontWeight="800"
      fontSize="138"
      letterSpacing="-5"
    >
      kaaval
    </text>
  </svg>
);

/* Extracted 10x10 diagonal arrow from getarbor.dev `.ext` */
export const ArborExtArrow: React.FC = () => (
  <svg className="arbor-ext" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M1.8 8.2 8.2 1.8M3 1.8h5.2V7" />
  </svg>
);

export const ArborNavbar: React.FC<NavbarProps> = ({
  activeRoute,
  sonarArmed,
  onNavigate,
  onPrimaryAction,
}) => {
  return (
    <header className="arbor-mast" id="mast">
      <button
        type="button"
        className="arbor-mast__mark"
        onClick={() => onNavigate('OVERVIEW')}
        aria-label="Kaaval, home"
      >
        <KaavalMastWordmark />
      </button>

      <nav className="arbor-mast__nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const isCurrent = activeRoute === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`arbor-mast__link ${isCurrent ? 'is-active' : ''}`}
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        className={`arbor-pill ${sonarArmed ? 'is-armed' : ''}`}
        onClick={onPrimaryAction}
      >
        <span className={`arbor-pill__dot ${sonarArmed ? 'on' : ''}`} />
        <span>{sonarArmed ? 'Sonar active' : 'Arm sonar'}</span>
      </button>
    </header>
  );
};

const AI_ASK_QUERY = encodeURIComponent(
  'How does 18–20 kHz FMCW ultrasonic sonar with OS-CFAR and coherent IQ phase demodulation detect human breathing and falls in a room using a laptop speaker and microphone with zero optical camera?'
);

export const ArborFooter: React.FC<FooterProps> = ({
  sonarArmed,
  creditLocked,
  benchmarkTrialsCount,
  lanCaregiverUrl,
  onNavigate,
  onToggleCreditLock,
  onPrimaryAction,
}) => {
  const [statusNote, setStatusNote] = useState<string>('');

  const copyLanLink = async () => {
    const target = lanCaregiverUrl || `${window.location.origin}/caregiver`;
    try {
      await navigator.clipboard.writeText(target);
      setStatusNote(`Copied ${target}`);
    } catch {
      setStatusNote(target);
    }
    window.setTimeout(() => setStatusNote(''), 3200);
  };

  return (
    <footer className="arbor-foot">
      {/* Row 1: Arbor `.sup` strip with 1px bottom hairline */}
      <section className="arbor-sup" aria-labelledby="h-kaaval-sup">
        <h2 id="h-kaaval-sup">Built on</h2>
        <ul className="arbor-sup__list">
          <li>
            <svg className="arbor-mk" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3 15a9 9 0 0 1 18 0" />
              <path d="M7 17a5 5 0 0 1 10 0" />
              <circle cx="12" cy="19" r="1.8" fill="currentColor" />
            </svg>
            <span>WebAudio 20 kHz FDMA</span>
          </li>
          <li>
            <svg className="arbor-mk" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M12 3v18M7 7v10M17 7v10M3 11v2M21 11v2" />
            </svg>
            <span>Sarvam Malayalam AI</span>
          </li>
          <li>
            <svg className="arbor-mk" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2.5 19.5 6v6c0 5-3.2 8.4-7.5 9.8C7.7 20.4 4.5 17 4.5 12V6L12 2.5Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span>Zero-Camera Privacy</span>
          </li>
        </ul>
      </section>

      {/* Row 2: Arbor `.foot__cols` 4-column Martian Mono navigation */}
      <div className="arbor-foot__cols">
        <nav aria-label="Kaaval workspace">
          <h2>Kaaval</h2>
          <ul>
            <li>
              <button type="button" onClick={() => onNavigate('OVERVIEW')}>
                Product overview
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate('CONSOLE')}>
                Live room console
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate('BENCHMARK')}>
                4×4 benchmark ({benchmarkTrialsCount})
              </button>
            </li>
            <li>
              <button type="button" onClick={onPrimaryAction}>
                {sonarArmed ? 'Open armed sonar' : 'Arm 20 kHz sonar'}
              </button>
            </li>
          </ul>
        </nav>

        <nav aria-label="Companion devices">
          <h2>Companion nodes</h2>
          <ul>
            <li>
              <button type="button" onClick={() => onNavigate('CAREGIVER')}>
                Caregiver phone app
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate('SATELLITE')}>
                POCO Node B satellite
              </button>
            </li>
            <li>
              <button type="button" onClick={copyLanLink}>
                Copy LAN caregiver URL
              </button>
            </li>
          </ul>
        </nav>

        <nav aria-label="Runtime safeguards">
          <h2>Safeguards &amp; stack</h2>
          <ul>
            <li>
              <button type="button" onClick={onToggleCreditLock}>
                {creditLocked ? 'Credit lock: ON (0 CR)' : 'Sarvam API: LIVE'}
              </button>
            </li>
            <li>
              <a
                href="https://docs.sarvam.ai"
                target="_blank"
                rel="noreferrer"
              >
                Bulbul v3 + Saaras v4
                <ArborExtArrow />
              </a>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate('CONSOLE')}>
                &lt;17.5 kHz firewall (-115 dB)
              </button>
            </li>
          </ul>
        </nav>

        {/* Extracted `.foot__ask` + `.askbar` with Arbor's exact monochrome AI marks & lime hover */}
        <nav className="arbor-foot__ask" aria-labelledby="h-kaaval-ask">
          <h2 id="h-kaaval-ask">Verify the physics</h2>
          <ul className="arbor-askbar">
            <li>
              <a
                href={`https://chatgpt.com/?q=${AI_ASK_QUERY}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Verify acoustic physics in ChatGPT"
                title="Ask ChatGPT about 20 kHz FMCW + OS-CFAR physics"
              >
                <svg className="arbor-mk" viewBox="-0.5 -0.5 25 25" aria-hidden="true">
                  <path
                    fill="currentColor"
                    fillRule="evenodd"
                    d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"
                  />
                </svg>
              </a>
            </li>
            <li>
              <a
                href={`https://claude.ai/new?q=${AI_ASK_QUERY}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Verify acoustic physics in Claude"
                title="Ask Claude about 20 kHz FMCW + OS-CFAR physics"
              >
                <svg className="arbor-mk" viewBox="-0.2 -0.2 24.4 24.4" aria-hidden="true">
                  <path
                    fill="currentColor"
                    fillRule="evenodd"
                    d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
                  />
                </svg>
              </a>
            </li>
            <li>
              <a
                href="https://gemini.google.com/app"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open Gemini"
                title="Open Google Gemini"
              >
                <svg className="arbor-mk" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    fillRule="evenodd"
                    d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
                  />
                </svg>
              </a>
            </li>
            <li>
              <button
                type="button"
                onClick={copyLanLink}
                aria-label="Copy LAN caregiver URL"
                title="Copy LAN caregiver phone URL"
              >
                <svg className="arbor-mk" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </li>
          </ul>
          <p className="arbor-foot__askmsg" role="status" aria-live="polite">
            {statusNote}
          </p>
        </nav>
      </div>

      {/* Row 3: Arbor `.foot__line.fnote` */}
      <p className="arbor-foot__line">
        Kaaval 1.0 · HackaThoni Alappuzha · 8/8 ultrasonic physics suites verified · 0 px camera ·
        &lt;17.5 kHz speech zeroed in AudioWorklet
      </p>

      {/* Row 4: Arbor `.foot__mark` monumental full-bleed lime wordmark */}
      <button
        type="button"
        className="arbor-foot__mark"
        onClick={() => {
          onNavigate('OVERVIEW');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        aria-label="Kaaval, scroll to top"
      >
        <KaavalMonumentWordmark />
      </button>
    </footer>
  );
};
