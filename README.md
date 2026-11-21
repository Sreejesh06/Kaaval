# Kaaval

**Zero-Hardware, Zero-Camera Stereo Ultrasonic Sonar, Sonic Ironbow Acoustic Imager, and Consent-Gated Malayalam Voice Triage for Independent Elder Care.**

Kaaval turns an unmodified laptop or bedside phone into a non-contact room safety instrument with **zero cameras** (MacBook hardware camera indicator LED stays strictly dark—zero `getUserMedia({ video })` anywhere in the codebase), zero wearables, and zero always-listening cloud microphones. During routine monitoring, Kaaval senses range, 2D floor azimuth, fall kinematics, and sub-millimeter chest respiration strictly above `17.5 kHz`; audible speech capture opens only inside a bounded check-in window after a verified physical anomaly.

---

## 1. Problem & Verified Kerala Context

Kerala is undergoing India's fastest demographic transition alongside sustained out-migration of working-age adults:

- **Rapid Population Aging (UNFPA / IIPS *India Ageing Report 2023*):** Adults aged 60+ already constitute **16.5%** of Kerala's population (the highest share in India, vs. **10.1%** nationally) and are projected to reach **22.8%** by **2036**—nearly one in four residents.
- **Emigration & Skip-Generation Households (*Kerala Migration Survey 2023*, GIFT / IIMAD):** An estimated **2.2 million** international emigrants from Kerala (including a doubling of student emigrants to **~2.5 lakh**) leave a high proportion of older parents living alone or in elderly-only households.
- **Unwitnessed Domestic Falls (*LASI Wave-1*, IIPS / MoHFW):** Kerala reports India's highest older-adult multimorbidity burden alongside elevated domestic slip/fall incidence, where prolonged floor lie-times ("long-lie" > 1 hour) sharply increase hospitalization and mortality.

Existing interventions fail adoption in Kerala homes for concrete operational reasons: bedroom/bathroom RGB cameras are rejected on dignity grounds, pendants and smartwatches fail during night bathroom trips or battery depletion, and continuous cloud voice assistants violate household conversational privacy.

---

## 2. System Architecture & Acoustic Physics

```
+-----------------------------------------------------------------------------------+
| BROWSER EDGE RUNTIME (Zero Camera Hardware · Zero Speech Egress During Monitoring)|
|                                                                                   |
|  [Stereo Speakers 48 kHz] ---> TX-L: 17.60-18.85 kHz  |  TX-R: 19.00-20.25 kHz    |
|                                       (Orthogonal Tukey-Tapered Linear FMCW)      |
|  [Raw Mic Stream] -----------> AudioWorklet (N=2048 @ 23.4375 fps)                |
|   (AEC/NS/AGC = false)          |-- <17.5 kHz DFT Brickwall Firewall (Zeroed)     |
|                                 |-- Dual Analytic Matched Filter + Clutter EMA    |
|                                 |-- L/R TDOA + ILD -> 2D (X, Z) & 28x15 Field     |
|                                 +-- Locked-Bin IQ Phase -> Sub-mm Chest BPM       |
|                                                                                   |
|  [Sonic Ironbow Imager] -----> Bilinear Polar Backprojection (0 px Optical)       |
|                                 |-- Cold Indigo: Static Room Clutter Envelope     |
|                                 +-- Ironbow Gold/White: Human Echo + Chest Phase  |
+-----------------------------------------+-----------------------------------------+
                                          | Physical Anomaly (Fall + Post-Spike
                                          | Stillness OR Prolonged Apnea)
                                          v
+-----------------------------------------------------------------------------------+
| CONSENT-GATED MALAYALAM VOICE TRIAGE & LAN COMPANION (Node / Express / WS)        |
|  1. Chirp Paused -> 2-Note Chime + Malayalam Prompt (bulbul:v3, disk-cached MP3)  |
|  2. 9.5s Consent Mic Window -> 16 kHz Int16 PCM -> saaras:v4 WS (saaras:v3 REST)  |
|  3. Parallel Triage: sarvam-105b-conversations + sarvam-translate:v1 (ml -> en)   |
|  4. Closing Malayalam Reassurance + /caregiver 2-Way LAN Companion Alert          |
+-----------------------------------------------------------------------------------+
```

### Mode A: Stereo FDMA Ultrasonic Sonar (`public/sonar-worklet.js`)
- **Orthogonal Stereo Sub-Bands:** Inside a single `2048`-sample frame at `fs = 48,000 Hz` (`23.4375 fps`), Channel 0 transmits a 256-sample Tukey-tapered linear FMCW chirp across **`17.60–18.85 kHz`** (`B = 1.25 kHz`) and Channel 1 across **`19.00–20.25 kHz`** (`B = 1.25 kHz`), chosen inside the flat high-frequency passband of consumer laptop tweeters before `>20.5 kHz` roll-off.
- **Audio-Thread `<17.5 kHz` Speech Firewall:** During `SONAR_LOCKED` operation, the in-place Radix-2 FFT zeroes all spectral bins below `17.5 kHz` (`corr[0..binFirewall-1] = 0`). Human speech harmonics (`120–8,000 Hz`, even `+20 dB` louder than target echoes) achieve **`< -115 dB`** leakage into matched-filter output, and zero PCM buffers leave the AudioWorklet.
- **2D Spatial Localization & Range-Selective Clutter:** Independent direct-path peak calibration (`directIdxL`, `directIdxR`) removes chassis mic-to-speaker asymmetry, blanking `< 0.48 m` screen/table ringdown. Target azimuth fuses L/R Time-Difference-of-Arrival across the `28 cm` speaker baseline with normalized Stereo Intensity Balance into `(X, Z)` coordinates and a `28 x 15` polar acoustic grid. Clutter subtraction uses range-selective adaptation (`alpha = 0.00025` within `±14` bins of `lockedBin`, `0.0045` elsewhere) so a stationary breathing or fallen resident is never absorbed into background clutter, while an 8-frame post-TTS resync suppresses false motion spikes when resuming ultrasound.
- **Coherent Sub-mm IQ Respiration:** Extracting complex clutter-removed baseband `IQ` at `lockedBin` yields phase sensitivity `(lambda / 4*pi) * dPhi` (`lambda ≈ 18.4–19.1 mm`), resolving `±0.2–3.0 mm` chest wall motion via phase unwrapping, continuous bin-step phase re-anchoring, and normalized autocorrelation (`10–30 BPM`).

### Sonic Ironbow Acoustic Imager (`src/components/SonicIronbowView.tsx`)
- **100% Camera-Free Hardware Proof:** Zero `video` streams or vision models exist in the project—the laptop's hardware-wired green camera LED never illuminates, working identically in bright daylight or pitch-black bedrooms at 2 AM.
- **Acoustic Ironbow Backprojection:** Maps real static room reflection clutter (`ambientClutterProfile`) to cold indigo/purple (`[0.03 .. 0.34]` on a 256-stop scientific Ironbow LUT) while rendering active stereo ultrasonic human reflections (`spatialGrid`, perspective-scaled `1/R` range, L/R azimuth, motion flare, and IQ chest respiration pulse) in glowing crimson, orange, gold, and incandescent yellow-white with a `-60 to 0 dB` scale bar.

---

## 3. Prior Art & Measured Engineering Boundaries

| System | Modality & Hardware | Range / Spatial Capability | Privacy & Triage Model | Key Limitation vs. Kaaval |
| :--- | :--- | :--- | :--- | :--- |
| **SoundWave** (*Gupta et al., CHI '12*) | Unmodified laptop `18–22 kHz` CW single-tone Doppler | Near-field gesture velocity only; **no absolute range** | No speech capture; no triage | Continuous-wave tone cannot separate target range, static multipath, or resting respiration. |
| **ApneaApp** (*Nandakumar et al., MobiSys '15*) | Smartphone mono FMCW (`18–20 kHz`) | `0.3–1.0 m` 1D bedside chest range; **no 2D azimuth** | Sleep logging only; no voice agent | Mono channel lacks 2D `(X, Z)` TDOA/ILD localization, whole-room fall kinematics, and verbal check-in. |
| **RuView / WiFi-CSI** (*Widar / ESP32-CSI*) | `2.4 / 5 GHz` OFDM Channel State Information | Through-wall multi-meter occupancy & gait | RF-only; no native voice loop | Requires custom CSI NIC firmware (`Nexmon` / ESP32 nodes); **impossible on stock consumer browsers**. |
| **Kaaval** (*Ours*) | Stock browser Stereo FDMA FMCW (`17.6–20.25 kHz`, **0 Camera**) | `0.48–3.0 m` range (`<1 cm` peak) + `±52 deg` 2D azimuth + IQ BPM | `<17.5 kHz` audio firewall + consent-gated Malayalam triage | Single-room line-of-sight acoustics; ultrasound reflects off closed doors/walls. |

### Honest Physical Boundaries
1. **Single-Room Acoustic Containment:** `17.6–20.25 kHz` acoustic waves do not penetrate closed wooden/masonry bathroom doors (`>35 dB` attenuation); one bedside or hall device covers a single `0.48 m – 3.0 m` room cone.
2. **Rayleigh vs. Phase Resolution:** With `B = 1.25 kHz` per stereo channel, two-target Rayleigh separation is `c / (2B) = 13.9 cm`, whereas single-target range-bin quantization at `48 kHz` is `0.3625 cm` (`< 1.0 cm` verified peak error) and differential chest tracking uses carrier phase (`< 0.5 mm`).
3. **Hardware Audio Path Requirements:** Requires built-in stereo speakers and microphone at `48 kHz` with browser DSP disabled (`echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`). Bluetooth HFP headsets (`8/16 kHz` bandwidth) strip ultrasonic frequencies; the worklet clamps FFT bin indices safely to prevent `NaN` degradation and flags single-channel fallback.
4. **Pet & Fan Immunity:** Ceiling fans remain in fixed range/elevation clutter bins; low-mass floor motion without a high-energy impact transient followed by stillness (`peakMotion >= 4.2` and `postSpikeMotion < 1.35`) or verbal unresponsiveness does not escalate to emergency dispatch.

---

## 4. Consent-Gated Sarvam AI Pipeline & Caregiver Companion

When physical sensing confirms `FALL_IMPACT_AND_STILLNESS` or `PROLONGED_ABSENCE_OF_RESPIRATION`, Kaaval transitions out of silent sonar mode into a deterministic Malayalam check-in state machine (`server/sarvam.ts`, `server/index.ts`):

1. **Prompt Synthesis (`bulbul:v3`):** Plays a gentle C5–E5 chime through the unlocked WebAudio context followed by a respectful Malayalam check-in (`"അമ്മേ..."`). Prompts are cached on disk (`data/tts-cache.json`) for `1 ms` repeat playback and zero redundant API spend.
2. **Streaming Malayalam STT (`saaras:v4` + `saaras:v3` Fallback):** Opens a `9.5 s` consent window streaming `16 kHz` `Int16` PCM over `/ws/stt` to `wss://api.sarvam.ai/speech-to-text-realtime/ws` (`ml-IN`). If upstream WebSocket finalization does not settle within `850 ms` of window close while speech frames exist, the server wraps buffered PCM into a `16 kHz` RIFF WAV and falls back automatically to REST `saaras:v3` (`POST /speech-to-text`).
3. **Parallel Clinical Triage & Translation (`sarvam-105b-conversations` + `sarvam-translate:v1`):** Evaluates spoken Malayalam alongside physical context (`distanceMeters`, `peakMotionEnergy`, `respirationBpmBefore`) in parallel, returning strict JSON (`SAFE | EMERGENCY | UNRESPONSIVE`), an English clinical summary for family caregivers, and a reassuring closing Malayalam reply synthesized via `bulbul:v3`. Complete silence across the consent window conservatively escalates as `UNRESPONSIVE`.
4. **Credit-Guard Dev Lock:** `creditGuardLocked` defaults to `true` on boot so calibration and offline physics benchmarks spend `0` Sarvam credits until explicitly unlocked in the operator bar.
5. **2-Way Caregiver LAN Companion (`/caregiver`):** Accessible from any phone or laptop on the same Wi-Fi/LAN, `/caregiver` streams structured incident cards, `ml-IN -> en-IN` translations, live range/azimuth/respiration telemetry, and two-way caregiver check-in triggers without exposing raw room audio or camera feeds.

---

## 5. Quickstart & Verification

### Prerequisites
- Node.js `>= 20` (`v22+` recommended)
- macOS / Linux / Windows laptop with built-in stereo speakers and microphone (unplug Bluetooth headsets; set speaker volume to `50–65%`)
- Optional `.env` with `SARVAM_API_KEY=...` for live Malayalam cloud triage (offline sonar, Ironbow silhouette, and Credit-Guard simulation run without keys)

### Install & Run
```bash
npm install
npm run verify
npm run dev:server
npm run dev:client
```
- **Primary Resident / Observatory Console:** `http://localhost:5173`
- **Caregiver Companion View:** `http://localhost:5173/caregiver` (or via LAN IP)

### Deterministic Physics Verification (`node scripts/verify-physics.mjs`)
`npm run verify` executes a zero-network `< 1s` harness directly against `public/sonar-worklet.js` and `server/trialsStore.ts`:
- **Test 1 (FMCW Range Accuracy):** Recovers `0.75 m`, `1.35 m`, and `2.15 m` continuous-delay echoes within **`0.33 cm`** (`< 1.0 cm` threshold) and verifies `16 kHz` Bluetooth HFP `NaN` immunity.
- **Test 2 (`<17.5 kHz` Speech Firewall):** Confirms `10x` amplitude (`+20 dB`) `120–8,000 Hz` speech harmonics leak **`< -115 dB`** (`< -90 dB` threshold) into matched-filter correlation energy.
- **Test 3 (Sub-mm IQ Respiration):** Recovers **`14.96 BPM`** (`0.04 BPM` error vs. `15.00 BPM` ground truth) on a `15 s` (`352`-frame) `0.95 m ± 2.5 mm` simulated chest and verifies `0.00` post-TTS resync motion spike.
- **Test 4 (Kinematic Fall Separation):** Verifies `4/4` separation across `EMPTY_CABIN`, `SEATED_BREATHING`, `WALKING_NORMAL`, and `FALL_STILLNESS`.
