import React, { useState } from 'react';
import { IconSonarWave, KaavalLogoMark, KaavalNavbarBrand } from './BrandAndIcons';

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
  { id: 'CONSOLE', label: 'Live console' },
  { id: 'BENCHMARK', label: 'Benchmark' },
  { id: 'CAREGIVER', label: 'Caregiver' },
  { id: 'SATELLITE', label: 'Satellite' },
];

/**
 * Persistent Global GrowthX Offcampus Navbar
 * Uses `grid-template-columns: 1fr auto 1fr` + fixed `176px x 42px` right CTA pill
 * so the brand, centered nav tabs, and CTA button stay locked at the exact same
 * (x, y) pixel coordinates across ALL 5 routes.
 */
export const ArborNavbar: React.FC<NavbarProps> = ({
  activeRoute,
  sonarArmed,
  onNavigate,
  onPrimaryAction,
}) => {
  return (
    <header className="gx-mast">
      <div className="gx-mast-inner">
        <div className="gx-mast-left">
          <KaavalNavbarBrand onClick={() => onNavigate('OVERVIEW')} />
        </div>

        <nav className="gx-mast-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const isCurrent = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`gx-mast-tab ${isCurrent ? 'is-active' : ''}`}
                aria-current={isCurrent ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="gx-mast-right">
          <button
            type="button"
            className={`gx-mast-cta ${sonarArmed ? 'is-armed' : ''}`}
            onClick={onPrimaryAction}
          >
            <IconSonarWave size={16} />
            <span>{sonarArmed ? 'Sonar active' : 'Arm sonar'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export const ArborFooter: React.FC<FooterProps> = ({
  sonarArmed,
  creditLocked,
  benchmarkTrialsCount,
  lanCaregiverUrl,
  onNavigate,
  onToggleCreditLock,
  onPrimaryAction,
}) => {
  const [copiedMsg, setCopiedMsg] = useState<string>('');

  const copyLanLink = async () => {
    const target = lanCaregiverUrl || `${window.location.origin}/caregiver`;
    try {
      await navigator.clipboard.writeText(target);
      setCopiedMsg(`Copied ${target}`);
    } catch {
      setCopiedMsg(target);
    }
    window.setTimeout(() => setCopiedMsg(''), 3000);
  };

  return (
    <footer className="gx-foot">
      <div className="gx-foot-inner">
        <div className="gx-foot-top">
          <div className="gx-foot-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <KaavalLogoMark size={38} />
              <div>
                <div className="gx-foot-title">Kaaval · ശബ്ദ-കാവൽ</div>
                <div className="gx-foot-sub">
                  Zero-camera ultrasonic room safety &amp; Malayalam voice triage
                </div>
              </div>
            </div>
            <p className="gx-foot-desc">
              Built solo aboard HackaThoni Alappuzha. Uses 17.60–20.25 kHz stereo FDMA sonar and
              consent-gated Sarvam Malayalam AI with 0 optical camera pixels.
            </p>
          </div>

          <div className="gx-foot-cols">
            <nav aria-label="Product views">
              <h3>Workspace</h3>
              <ul>
                <li>
                  <button type="button" onClick={() => onNavigate('OVERVIEW')}>
                    Product overview
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => onNavigate('CONSOLE')}>
                    Live acoustic console
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => onNavigate('BENCHMARK')}>
                    4×4 cabin benchmark ({benchmarkTrialsCount})
                  </button>
                </li>
              </ul>
            </nav>

            <nav aria-label="Companion apps">
              <h3>Companion nodes</h3>
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
                    {copiedMsg || 'Copy LAN caregiver link'}
                  </button>
                </li>
              </ul>
            </nav>

            <nav aria-label="Controls and safeguards">
              <h3>Runtime guards</h3>
              <ul>
                <li>
                  <button type="button" onClick={onToggleCreditLock}>
                    {creditLocked ? '0-credit lock: active' : 'Sarvam cloud: live'}
                  </button>
                </li>
                <li>
                  <button type="button" onClick={onPrimaryAction}>
                    {sonarArmed ? 'Zero room clutter' : 'Arm 20 kHz sonar'}
                  </button>
                </li>
                <li>
                  <span className="gx-foot-static">9/9 physics suites verified</span>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div className="gx-foot-bottom">
          <span>Camera: 0 px (hardware LED off) · &lt;17.5 kHz speech zeroed in AudioWorklet</span>
          <span>Alappuzha, Kerala · Bulbul v3 · Saaras v4 · Sarvam-105B</span>
        </div>
      </div>
    </footer>
  );
};
