import React from 'react';

/**
 * Bespoke Kaaval Brand System & Vector Kit
 * Geometric SaaS emblem + Offcampus editorial display wordmark:
 * - #2958D4 electric cobalt, #16121C / #21182D deep night,
 * - #FFE24D sun-yellow CTA/accent, #1CE494 / #3ED598 sonic emerald, #B9A2FF lilac.
 */

export const KaavalLogoMark: React.FC<{ size?: number }> = ({ size = 34 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    {/* Crisp Cobalt SaaS squircle */}
    <rect
      x="2"
      y="2"
      width="36"
      height="36"
      rx="10"
      fill="#2958D4"
      stroke="#FFFFFF"
      strokeOpacity="0.24"
      strokeWidth="1.5"
    />
    {/* Bold geometric K spine + arm in Sun-Yellow */}
    <path
      d="M12.5 11.5V28.5M12.5 20L21.5 11.5M15.5 17.5L23 28.5"
      stroke="#FFE24D"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Radiating 20 kHz ultrasonic wavefront arcs on right */}
    <path
      d="M25.5 15.2C27.6 17.6 27.6 22.4 25.5 24.8"
      stroke="#1CE494"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
    <path
      d="M29.8 11.8C33.4 16.2 33.4 23.8 29.8 28.2"
      stroke="#FFFFFF"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </svg>
);

export const KaavalNavbarBrand: React.FC<{ onClick?: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="gx-brand-btn"
    aria-label="Kaaval home"
  >
    <KaavalLogoMark size={32} />
    <span className="gx-brand-word">Kaaval</span>
    <span className="gx-brand-ml">കാവൽ</span>
  </button>
);

/**
 * Monumental Hero Wordmark Lockup inspired by GrowthX Offcampus `wordmark-live.svg`:
 * Emerald #1CE494 sonic starburst + heavy extruded #FFFFFF lettering with
 * #16121C outline/shadow + tilted #FFE24D Malayalam sticker pill.
 */
export const KaavalHeroWordmark: React.FC = () => (
  <svg
    className="gx-hero-wordmark"
    viewBox="0 0 680 182"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Kaaval — Camera-free ultrasonic elder care"
  >
    {/* Asymmetric #1CE494 sonic burst splash behind wordmark */}
    <path
      d="M158 14L176 58L238 24L206 74L292 82L210 108L252 156L178 126L144 172L128 122L52 148L102 100L26 74L110 68L88 20L140 54L158 14Z"
      fill="#1CE494"
      stroke="#16121C"
      strokeWidth="3"
      strokeLinejoin="round"
    />

    {/* Right-side deep night + emerald ultrasonic radar badge */}
    <g transform="translate(566, 102)">
      <circle cx="4" cy="4" r="50" fill="#16121C" />
      <circle cx="0" cy="0" r="50" fill="#21182D" stroke="#16121C" strokeWidth="3" />
      <path
        d="M-24 8a24 24 0 0 1 48 0"
        stroke="#1CE494"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M-36 -2a36 36 0 0 1 72 0"
        stroke="#FFE24D"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="0" cy="16" r="6" fill="#FF6FB1" stroke="#FFFFFF" strokeWidth="2" />
    </g>

    {/* Extruded 3D hard shadow layer */}
    <text
      x="306"
      y="128"
      textAnchor="middle"
      fontFamily="'Bricolage Grotesque', sans-serif"
      fontWeight="800"
      fontSize="94"
      letterSpacing="-3"
      fill="#16121C"
    >
      KAAVAL
    </text>

    {/* Crisp foreground white block wordmark with thick #16121C stroke */}
    <text
      x="300"
      y="122"
      textAnchor="middle"
      fontFamily="'Bricolage Grotesque', sans-serif"
      fontWeight="800"
      fontSize="94"
      letterSpacing="-3"
      fill="#FFFFFF"
      stroke="#16121C"
      strokeWidth="5"
      paintOrder="stroke fill"
      strokeLinejoin="round"
    >
      KAAVAL
    </text>

    {/* Tilted Malayalam sticker pill */}
    <g transform="translate(474, 14) rotate(4)">
      <rect x="3" y="3" width="124" height="36" rx="18" fill="#16121C" />
      <rect
        x="0"
        y="0"
        width="124"
        height="36"
        rx="18"
        fill="#FFE24D"
        stroke="#16121C"
        strokeWidth="2.5"
      />
      <text
        x="62"
        y="24"
        textAnchor="middle"
        fontFamily="'Noto Sans Malayalam', sans-serif"
        fontWeight="700"
        fontSize="17"
        fill="#16121C"
      >
        ശബ്ദ-കാവൽ
      </text>
    </g>

    {/* Offcampus 4-point sparkle stickers */}
    <path
      d="M72 20c2 12 6.8 16.8 18.8 18.8-12 2-16.8 6.8-18.8 18.8-2-12-6.8-16.8-18.8-18.8 12-2 16.8-6.8 18.8-18.8z"
      fill="#FFFFFF"
      stroke="#16121C"
      strokeWidth="2.6"
      strokeLinejoin="round"
    />
    <path
      d="M634 134c1.3 8 4.5 11.2 12.5 12.5-8 1.3-11.2 4.5-12.5 12.5-1.3-8-4.5-11.2-12.5-12.5 8-1.3 11.2-4.5 12.5-12.5z"
      fill="#B9A2FF"
      stroke="#16121C"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
  </svg>
);

export const SparkleStarSvg: React.FC<{ className?: string; fill?: string; size?: number }> = ({
  className,
  fill = '#FFFFFF',
  size = 20,
}) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      d="M12 0c1 7.6 4.4 11 12 12-7.6 1-11 4.4-12 12-1-7.6-4.4-11-12-12 7.6-1 11-4.4 12-12z"
      fill={fill}
    />
  </svg>
);

/* Extracted cloud silhouette transitioning Cobalt Hero (#2958D4) directly into Deep Plum-Night (#21182D) */
export const HeroCloudsDivider: React.FC<{ fill?: string }> = ({ fill = '#21182D' }) => (
  <div className="gx-clouds" aria-hidden="true">
    <svg
      className="gx-cloud-left"
      viewBox="0 0 453 207"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 14.024C24.5386 -1.3126 59.0461 -4.37993 85.8852 6.35572C118.092 18.625 138.03 46.231 131.895 73.8369C144.931 66.9354 157.201 74.6037 161.802 84.5726C178.672 67.7023 203.21 63.8681 221.614 74.6037C239.252 84.5726 247.687 103.743 245.386 125.981C254.588 122.147 262.256 125.981 266.857 132.116C285.261 111.412 310.567 109.111 328.971 120.614C339.706 128.282 346.608 139.784 347.375 153.587C368.079 145.919 396.452 155.888 399.519 181.96C423.291 176.592 443.996 188.862 452.431 206.499H0V14.024Z"
        fill={fill}
      />
    </svg>
    <svg
      className="gx-cloud-right"
      viewBox="0 0 453 207"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform: 'scaleX(-1)' }}
    >
      <path
        d="M0 14.024C24.5386 -1.3126 59.0461 -4.37993 85.8852 6.35572C118.092 18.625 138.03 46.231 131.895 73.8369C144.931 66.9354 157.201 74.6037 161.802 84.5726C178.672 67.7023 203.21 63.8681 221.614 74.6037C239.252 84.5726 247.687 103.743 245.386 125.981C254.588 122.147 262.256 125.981 266.857 132.116C285.261 111.412 310.567 109.111 328.971 120.614C339.706 128.282 346.608 139.784 347.375 153.587C368.079 145.919 396.452 155.888 399.519 181.96C423.291 176.592 443.996 188.862 452.431 206.499H0V14.024Z"
        fill={fill}
      />
    </svg>
  </div>
);

export const IconSonarWave: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 16a7 7 0 0 1 14 0" />
    <path d="M2 12a11 11 0 0 1 20 0" />
    <circle cx="12" cy="18" r="2.3" fill="currentColor" />
  </svg>
);

export const IconMicCheck: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <path d="M12 17v4M8 21h8" />
  </svg>
);

export const IconPhonePair: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="2" width="12" height="20" rx="3" />
    <circle cx="12" cy="18" r="1" fill="currentColor" />
    <path d="M10 6h4" />
  </svg>
);

export const IconSliders: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="2.2" fill="var(--page-default)" stroke="currentColor" />
    <circle cx="15" cy="12" r="2.2" fill="var(--page-default)" stroke="currentColor" />
    <circle cx="10" cy="18" r="2.2" fill="var(--page-default)" stroke="currentColor" />
  </svg>
);
