import React from 'react';

/**
 * Bespoke Kaaval Brand System & Vector Kit
 * Crafted directly in GrowthX Offcampus's vector language:
 * - #16121C ink outlines (2px–3px, round joins/caps), hard offset block shadows,
 * - #FFE24D sun-yellow, #1CE494 / #3ED598 sonic emerald, #2958D4 electric cobalt, #FFF4C1 cream.
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
    {/* Hard offset shadow block */}
    <rect x="5" y="5" width="32" height="32" rx="10" fill="#16121C" />
    {/* Tactile yellow badge */}
    <rect
      x="2.5"
      y="2.5"
      width="32"
      height="32"
      rx="10"
      fill="#FFE24D"
      stroke="#16121C"
      strokeWidth="2.5"
    />
    {/* Emerald acoustic wave sector */}
    <path
      d="M8.5 20.5C12.2 14.5 24.8 14.5 28.5 20.5"
      stroke="#16121C"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
    <path
      d="M12.2 24.2C14.8 20.2 22.2 20.2 24.8 24.2"
      stroke="#2958D4"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
    {/* Central acoustic guardian core */}
    <circle
      cx="18.5"
      cy="27.2"
      r="3.6"
      fill="#3ED598"
      stroke="#16121C"
      strokeWidth="2.2"
    />
    {/* Signature 4-point Offcampus sparkle */}
    <path
      d="M29.5 7.2c.5 2.8 1.7 4 4.5 4.5-2.8.5-4 1.7-4.5 4.5-.5-2.8-1.7-4-4.5-4.5 2.8-.5 4-1.7 4.5-4.5z"
      fill="#FFFFFF"
      stroke="#16121C"
      strokeWidth="1.5"
      strokeLinejoin="round"
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
 * Emerald #1CE494 sonic starburst splash + heavy extruded #FFFFFF/#FFE24D lettering with
 * crisp #16121C outlines and hard 6px block shadow.
 */
export const KaavalHeroWordmark: React.FC = () => (
  <svg
    className="gx-hero-wordmark"
    viewBox="0 0 680 188"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Kaaval — Camera-free ultrasonic elder care"
  >
    {/* Asymmetric #1CE494 sonic burst splash behind wordmark (Offcampus wordmark-live.svg craft) */}
    <path
      d="M168 12L186 58L248 24L216 74L302 82L220 108L262 158L188 128L154 176L138 124L58 152L108 102L28 74L116 68L92 18L148 54L168 12Z"
      fill="#1CE494"
      stroke="#16121C"
      strokeWidth="3"
      strokeLinejoin="round"
    />

    {/* Concentric ultrasonic wavefront badge on right */}
    <g transform="translate(566, 104)">
      <circle cx="4" cy="4" r="54" fill="#16121C" />
      <circle cx="0" cy="0" r="54" fill="#FFE24D" stroke="#16121C" strokeWidth="3" />
      <path
        d="M-26 6a26 26 0 0 1 52 0"
        stroke="#16121C"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M-38 -4a38 38 0 0 1 76 0"
        stroke="#2958D4"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <circle cx="0" cy="15" r="6.5" fill="#FF6FB1" stroke="#16121C" strokeWidth="2.6" />
    </g>

    {/* Extruded 3D hard shadow layer */}
    <text
      x="306"
      y="130"
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
      y="124"
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
    <g transform="translate(476, 14) rotate(5)">
      <rect x="3" y="3" width="122" height="38" rx="19" fill="#16121C" />
      <rect
        x="0"
        y="0"
        width="122"
        height="38"
        rx="19"
        fill="#FFE24D"
        stroke="#16121C"
        strokeWidth="2.5"
      />
      <text
        x="61"
        y="25"
        textAnchor="middle"
        fontFamily="'Noto Sans Malayalam', sans-serif"
        fontWeight="700"
        fontSize="17.5"
        fill="#16121C"
      >
        ശബ്ദ-കാവൽ
      </text>
    </g>

    {/* Extracted Offcampus 4-point sparkle stickers */}
    <path
      d="M74 20c2 12 6.8 16.8 18.8 18.8-12 2-16.8 6.8-18.8 18.8-2-12-6.8-16.8-18.8-18.8 12-2 16.8-6.8 18.8-18.8z"
      fill="#FFFFFF"
      stroke="#16121C"
      strokeWidth="2.8"
      strokeLinejoin="round"
    />
    <path
      d="M634 136c1.3 8 4.5 11.2 12.5 12.5-8 1.3-11.2 4.5-12.5 12.5-1.3-8-4.5-11.2-12.5-12.5 8-1.3 11.2-4.5 12.5-12.5z"
      fill="#B9A2FF"
      stroke="#16121C"
      strokeWidth="2.5"
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
export const HeroCloudsDivider: React.FC = () => (
  <div className="gx-clouds" aria-hidden="true">
    <svg
      className="gx-cloud-left"
      viewBox="0 0 453 207"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 14.024C24.5386 -1.3126 59.0461 -4.37993 85.8852 6.35572C118.092 18.625 138.03 46.231 131.895 73.8369C144.931 66.9354 157.201 74.6037 161.802 84.5726C178.672 67.7023 203.21 63.8681 221.614 74.6037C239.252 84.5726 247.687 103.743 245.386 125.981C254.588 122.147 262.256 125.981 266.857 132.116C285.261 111.412 310.567 109.111 328.971 120.614C339.706 128.282 346.608 139.784 347.375 153.587C368.079 145.919 396.452 155.888 399.519 181.96C423.291 176.592 443.996 188.862 452.431 206.499H0V14.024Z"
        fill="#FFF4C1"
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
        fill="#FFF4C1"
      />
    </svg>
  </div>
);

/* Matching 2px #16121C round-cap/join UI & Sticker Icons */
export const IconSonarWave: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 16a7 7 0 0 1 14 0" />
    <path d="M2 12a11 11 0 0 1 20 0" />
    <circle cx="12" cy="18" r="2.5" fill="currentColor" />
  </svg>
);

export const IconMicCheck: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <path d="M12 17v4M8 21h8" />
  </svg>
);

export const IconPhonePair: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="2" width="12" height="20" rx="3" />
    <circle cx="12" cy="18" r="1" fill="currentColor" />
    <path d="M10 6h4" />
  </svg>
);

export const IconSliders: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="2.2" fill="#FFE24D" />
    <circle cx="15" cy="12" r="2.2" fill="#3ED598" />
    <circle cx="10" cy="18" r="2.2" fill="#B9A2FF" />
  </svg>
);
