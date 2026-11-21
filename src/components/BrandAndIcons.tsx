import React from 'react';

/**
 * Bespoke Kaaval Brand System & Vector Kit — GrowthX Offcampus Craft
 * - #16121C ink outlines (2px–3px, round joins/caps), hard offset block shadows,
 * - #FFE24D sun-yellow, #2958D4 electric cobalt, #1CE494 / #3ED598 sonic emerald, #FFF4C1 cream.
 * - Optically centered around x = 340 in viewBox="0 0 680 180".
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
    {/* Hard offset #16121C block shadow */}
    <rect x="5" y="5" width="32" height="32" rx="9" fill="#16121C" />
    {/* Tactile Sun-Yellow badge */}
    <rect
      x="2.5"
      y="2.5"
      width="32"
      height="32"
      rx="9"
      fill="#FFE24D"
      stroke="#16121C"
      strokeWidth="2.4"
    />
    {/* Bold geometric K in #16121C */}
    <path
      d="M11.5 11V26M11.5 18.5L19 11M14.2 16.2L20.5 26"
      stroke="#16121C"
      strokeWidth="3.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Radiating Cobalt + Emerald 20 kHz wavefronts */}
    <path
      d="M23.2 14.5C25.2 16.8 25.2 20.2 23.2 22.5"
      stroke="#2958D4"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
    <path
      d="M27.2 11.5C30.5 15.4 30.5 21.6 27.2 25.5"
      stroke="#16121C"
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
    <KaavalLogoMark size={34} />
    <span className="gx-brand-word">Kaaval</span>
    <span className="gx-brand-ml">കാവൽ</span>
  </button>
);

/**
 * Monumental Hero Wordmark Lockup inspired by GrowthX Offcampus `wordmark-live.svg`:
 * Dead-center KAAVAL lettering at x=340 inside 680x180 viewBox, balanced with
 * left #1CE494 sonic burst and right tilted #FFE24D Malayalam sticker pill.
 */
export const KaavalHeroWordmark: React.FC = () => (
  <svg
    className="gx-hero-wordmark"
    viewBox="0 0 680 176"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Kaaval — Camera-free ultrasonic elder care"
  >
    {/* Left asymmetric #1CE494 sonic burst splash */}
    <path
      d="M148 16L164 56L218 26L190 70L264 78L194 102L230 146L166 120L136 162L122 116L54 140L98 96L32 72L106 66L86 22L132 52L148 16Z"
      fill="#1CE494"
      stroke="#16121C"
      strokeWidth="3"
      strokeLinejoin="round"
    />

    {/* Right concentric ultrasonic badge */}
    <g transform="translate(568, 102)">
      <circle cx="4" cy="4" r="44" fill="#16121C" />
      <circle cx="0" cy="0" r="44" fill="#FFE24D" stroke="#16121C" strokeWidth="3" />
      <path
        d="M-21 7a21 21 0 0 1 42 0"
        stroke="#16121C"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M-32 -2a32 32 0 0 1 64 0"
        stroke="#2958D4"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="0" cy="14" r="5.5" fill="#FF6FB1" stroke="#16121C" strokeWidth="2.4" />
    </g>

    {/* Extruded 3D hard shadow layer — centered at x=346 (340 + 6px offset) */}
    <text
      x="346"
      y="128"
      textAnchor="middle"
      fontFamily="'Bricolage Grotesque', sans-serif"
      fontWeight="800"
      fontSize="92"
      letterSpacing="-3"
      fill="#16121C"
    >
      KAAVAL
    </text>

    {/* Foreground white block wordmark — mathematically centered at x=340 */}
    <text
      x="340"
      y="122"
      textAnchor="middle"
      fontFamily="'Bricolage Grotesque', sans-serif"
      fontWeight="800"
      fontSize="92"
      letterSpacing="-3"
      fill="#FFFFFF"
      stroke="#16121C"
      strokeWidth="5"
      paintOrder="stroke fill"
      strokeLinejoin="round"
    >
      KAAVAL
    </text>

    {/* Tilted Malayalam sticker pill at top-right */}
    <g transform="translate(492, 16) rotate(4)">
      <rect x="3" y="3" width="124" height="36" rx="18" fill="#16121C" />
      <rect
        x="0"
        y="0"
        width="124"
        height="36"
        rx="18"
        fill="#E4F25C"
        stroke="#16121C"
        strokeWidth="2.5"
      />
      <text
        x="62"
        y="24"
        textAnchor="middle"
        fontFamily="'Noto Sans Malayalam', sans-serif"
        fontWeight="700"
        fontSize="16.5"
        fill="#16121C"
      >
        ശബ്ദ-കാവൽ
      </text>
    </g>

    {/* Extracted Offcampus 4-point static vector sparkles */}
    <path
      d="M66 22c1.8 10.5 6 14.7 16.5 16.5-10.5 1.8-14.7 6-16.5 16.5-1.8-10.5-6-14.7-16.5-16.5 10.5-1.8 14.7-6 16.5-16.5z"
      fill="#FFFFFF"
      stroke="#16121C"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path
      d="M632 130c1.2 7.2 4 10 11.2 11.2-7.2 1.2-10 4-11.2 11.2-1.2-7.2-4-10-11.2-11.2 7.2-1.2 10-4 11.2-11.2z"
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

/* Extracted directly from growthx.club/_next_public/images/offcampus/cloud-bottom-left.svg */
export const HeroCloudsDivider: React.FC<{ fill?: string }> = ({ fill = '#FFF4C1' }) => (
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
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 16a7 7 0 0 1 14 0" />
    <path d="M2 12a11 11 0 0 1 20 0" />
    <circle cx="12" cy="18" r="2.2" fill="currentColor" />
  </svg>
);

export const IconMicCheck: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <path d="M12 17v4M8 21h8" />
  </svg>
);

export const IconPhonePair: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="2" width="12" height="20" rx="3" />
    <circle cx="12" cy="18" r="1" fill="currentColor" />
    <path d="M10 6h4" />
  </svg>
);

export const IconSliders: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="2.2" fill="currentColor" />
    <circle cx="15" cy="12" r="2.2" fill="currentColor" />
    <circle cx="10" cy="18" r="2.2" fill="currentColor" />
  </svg>
);
