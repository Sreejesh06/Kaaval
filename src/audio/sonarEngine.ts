import type { RadarFrame, SonarNodeProfile } from '../types';

export interface ConsentListenResult {
  transcriptMl: string;
  sttLatencyMs: number;
  sttModelUsed: string;
}

export class KaavalSonarEngine {
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private onRadarFrame: (frame: RadarFrame) => void;
  private onVoiceLevel?: (rmsDb: number) => void;
  private pcmForwarder: ((pcmBuffer: ArrayBuffer) => void) | null = null;

  constructor(
    onRadarFrame: (frame: RadarFrame) => void,
    onVoiceLevel?: (rmsDb: number) => void
  ) {
    this.onRadarFrame = onRadarFrame;
    this.onVoiceLevel = onVoiceLevel;
  }

  async start(
    initialLockMeters = 0.85,
    nodeProfile: SonarNodeProfile = 'SOLO_STEREO'
  ): Promise<{
    sampleRate: number;
    echoCancellation: boolean;
  }> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Microphone API requires https://<LAN-IP>:5443/satellite on Android Chrome or http://localhost.'
      );
    }

    if (this.audioCtx) {
      await this.audioCtx.resume();
      this.setNodeProfile(nodeProfile);
      return { sampleRate: this.audioCtx.sampleRate, echoCancellation: false };
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    const settings = this.stream.getAudioTracks()[0].getSettings();
    this.audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await this.audioCtx.audioWorklet.addModule('/sonar-worklet.js');

    const stereoCapable =
      nodeProfile !== 'SATELLITE_MONO' && this.audioCtx.destination.maxChannelCount >= 2;
    const micSource = this.audioCtx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioCtx, 'kaaval-dual-worklet', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [this.audioCtx.destination.maxChannelCount >= 2 ? 2 : 1],
      processorOptions: {
        sampleRate: this.audioCtx.sampleRate,
        stereoCapable,
        nodeProfile,
      },
    });

    this.workletNode.port.postMessage({
      type: 'lock_range',
      meters: initialLockMeters,
    });

    this.workletNode.port.onmessage = (e) => {
      const data = e.data;
      if (data.kind === 'radar') {
        this.onRadarFrame(data as RadarFrame);
      } else if (data.kind === 'pcm16') {
        if (this.onVoiceLevel) this.onVoiceLevel(data.rmsDb);
        if (this.pcmForwarder) this.pcmForwarder(data.pcmBuffer);
      }
    };

    micSource.connect(this.workletNode);
    this.workletNode.connect(this.audioCtx.destination);

    return {
      sampleRate: this.audioCtx.sampleRate,
      echoCancellation: Boolean(settings.echoCancellation),
    };
  }

  zeroClutter() {
    this.workletNode?.port.postMessage({ type: 'zero_clutter' });
  }

  recalibrateDirectPath() {
    this.workletNode?.port.postMessage({ type: 'recalibrate' });
  }

  setGain(value: number) {
    this.workletNode?.port.postMessage({ type: 'set_gain', value });
  }

  setRangeLock(meters: number) {
    this.workletNode?.port.postMessage({ type: 'lock_range', meters });
  }

  setWorkletMode(mode: 'SONAR_LOCKED' | 'VOICE_PAUSE' | 'VOICE_LISTEN') {
    this.workletNode?.port.postMessage({ type: 'set_mode', mode });
  }

  setNodeProfile(profile: SonarNodeProfile) {
    this.workletNode?.port.postMessage({ type: 'set_node_profile', profile });
  }

  /**
   * Plays a gentle 2-note clinical chime followed by decoded base64 MP3 through the
   * already-unlocked AudioContext (immune to browser autoplay blocks on hands-free falls).
   */
  async playAlertToneAndBase64Audio(audioBase64: string, playChime = true): Promise<void> {
    if (!this.audioCtx) return;
    await this.audioCtx.resume();

    if (playChime) {
      await this.playTwoNoteChime();
    }
    if (!audioBase64) return;

    const binStr = atob(audioBase64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }

    const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer.slice(0));
    await new Promise<void>((resolve) => {
      if (!this.audioCtx) return resolve();
      const src = this.audioCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(this.audioCtx.destination);
      src.onended = () => resolve();
      src.start();
    });
  }

  private playTwoNoteChime(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.audioCtx) return resolve();
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.14); // E5
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.onended = () => resolve();
      osc.start(now);
      osc.stop(now + 0.35);
    });
  }

  /**
   * Opens the 10-second Consent Speech Window:
   * Streams 16 kHz Int16 PCM to /ws/stt -> Sarvam Saaras v4 Realtime WS,
   * emits partial transcripts live, and resolves as soon as speech completes or window expires.
   */
  streamConsentWindow(
    maxDurationMs: number,
    onPartial: (text: string, vadActive: boolean) => void
  ): Promise<ConsentListenResult> {
    return new Promise((resolve) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/stt`);
      const startedAt = performance.now();

      let finalSegments: string[] = [];
      let latestPartial = '';
      let vadActive = false;
      let modelUsed = 'saaras:v4';
      let settled = false;
      let postFinalTimer: number | null = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        this.pcmForwarder = null;
        this.setWorkletMode('SONAR_LOCKED');
        if (postFinalTimer) window.clearTimeout(postFinalTimer);
        window.clearTimeout(hardTimer);
        try {
          ws.close();
        } catch {
          // Ignore close error
        }
        const combined = [...finalSegments, latestPartial].join(' ').trim();
        resolve({
          transcriptMl: combined,
          sttLatencyMs: Math.round(performance.now() - startedAt),
          sttModelUsed: modelUsed,
        });
      };

      const hardTimer = window.setTimeout(() => {
        this.pcmForwarder = null;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'finish_window' }));
          // Allow up to 4.2s for server-side Saaras v3 WAV fallback on slow 4G
          window.setTimeout(finish, 4200);
        } else {
          finish();
        }
      }, maxDurationMs);

      ws.onopen = () => {
        this.setWorkletMode('VOICE_LISTEN');
        this.pcmForwarder = (pcmBuf) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(pcmBuf);
          }
        };
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as {
            event?: string;
            text?: string;
            modelUsed?: string;
          };
          if (msg.modelUsed) modelUsed = msg.modelUsed;

          if (msg.event === 'vad.speech_start') {
            vadActive = true;
            if (postFinalTimer) {
              window.clearTimeout(postFinalTimer);
              postFinalTimer = null;
            }
            onPartial(
              [...finalSegments, latestPartial].join(' ').trim(),
              true
            );
          } else if (msg.event === 'vad.speech_end') {
            vadActive = false;
          } else if (msg.event === 'transcript.partial') {
            latestPartial = msg.text || '';
            if (latestPartial && postFinalTimer) {
              window.clearTimeout(postFinalTimer);
              postFinalTimer = null;
            }
            onPartial(
              [...finalSegments, latestPartial].join(' ').trim(),
              vadActive
            );
          } else if (msg.event === 'transcript.final') {
            if (msg.text && msg.text.trim()) {
              finalSegments.push(msg.text.trim());
              latestPartial = '';
            }
            onPartial(finalSegments.join(' '), false);
            // Allow natural pauses between words: wait 2.1s of silence AND a real phrase (>=12 chars)
            if (finalSegments.join(' ').length >= 12) {
              if (postFinalTimer) window.clearTimeout(postFinalTimer);
              postFinalTimer = window.setTimeout(finish, 2100);
            }
          } else if (msg.event === 'window.complete') {
            finish();
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onerror = () => {
        finish();
      };
    });
  }
}
