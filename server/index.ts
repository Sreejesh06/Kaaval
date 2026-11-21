import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CHECKIN_PROMPTS,
  sarvamStats,
  synthesizeMalayalam,
  transcribeFallbackRest,
  triageCheckinResponse,
  warmPromptCache,
} from './sarvam.js';
import {
  addBenchmarkTrial,
  appendIncident,
  classifyTrialFeatures,
  clearBenchmarkTrials,
  computeBenchmarkSummary,
  listIncidents,
} from './trialsStore.js';
import type { AnomalyTriggerReason, GroundTruthClass, IncidentRecord } from '../src/types.js';

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    sarvamKeyConfigured: Boolean(process.env.SARVAM_API_KEY),
    creditGuardLocked: sarvamStats.creditGuardLocked,
    sarvamStats,
  });
});

app.post('/api/credit-guard', (req, res) => {
  sarvamStats.creditGuardLocked = Boolean(req.body?.locked);
  res.json({ creditGuardLocked: sarvamStats.creditGuardLocked, sarvamStats });
});

app.get('/api/prompt-audio', async (req, res) => {
  try {
    const trigger = (req.query.trigger as AnomalyTriggerReason) || 'FALL_IMPACT_AND_STILLNESS';
    const promptMl = CHECKIN_PROMPTS[trigger] || CHECKIN_PROMPTS.FALL_IMPACT_AND_STILLNESS;
    const { audioBase64, trace } = await synthesizeMalayalam(promptMl);
    res.json({ promptMl, audioBase64, trace });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/triage', async (req, res) => {
  try {
    const {
      trigger,
      transcriptMl,
      distanceMeters,
      peakMotionEnergy,
      respirationBpmBefore,
      sttLatencyMs,
      sttModelUsed,
    } = req.body as {
      trigger: AnomalyTriggerReason;
      transcriptMl: string;
      distanceMeters: number;
      peakMotionEnergy: number;
      respirationBpmBefore: number | null;
      sttLatencyMs?: number;
      sttModelUsed?: string;
    };

    const promptMl = CHECKIN_PROMPTS[trigger] || CHECKIN_PROMPTS.FALL_IMPACT_AND_STILLNESS;
    const sttTrace = sttModelUsed
      ? {
          model: sttModelUsed,
          endpoint: 'WSS /speech-to-text-realtime/ws',
          latencyMs: sttLatencyMs || 0,
          detail: transcriptMl
            ? `Captured Malayalam speech (${transcriptMl.length} chars)`
            : '10s consent window elapsed with zero speech VAD',
        }
      : undefined;

    const result = await triageCheckinResponse({
      trigger,
      transcriptMl: transcriptMl || '',
      distanceMeters: Number(distanceMeters || 0),
      peakMotionEnergy: Number(peakMotionEnergy || 0),
      respirationBpmBefore: respirationBpmBefore ?? null,
      sttTrace,
    });

    const record: IncidentRecord = {
      id: crypto.randomUUID(),
      timestampIso: new Date().toISOString(),
      trigger,
      distanceMeters: Number(distanceMeters || 0),
      peakMotionEnergy: Number(peakMotionEnergy || 0),
      respirationBpmBefore: respirationBpmBefore ?? null,
      promptMl,
      transcriptMl: transcriptMl || '',
      transcriptEn: result.transcriptEn,
      classification: result.classification,
      clinicalSummaryEn: result.clinicalSummaryEn,
      replyMl: result.replyMl,
      replyAudioBase64: result.replyAudioBase64,
      sarvamTraces: result.traces,
    };

    const incidents = appendIncident(record);
    res.json({ record, incidents, sarvamStats });
  } catch (err) {
    console.error('[kaaval] /api/triage error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/incidents', (_req, res) => {
  res.json({ incidents: listIncidents(), sarvamStats });
});

app.get('/api/benchmark', (_req, res) => {
  res.json(computeBenchmarkSummary());
});

app.post('/api/benchmark/trial', (req, res) => {
  const {
    expected,
    durationSec,
    meanDistanceM,
    peakMotion,
    postSpikeMotion,
    breathStdMm,
    meanPresence,
    sonarSnrDb,
  } = req.body as {
    expected: GroundTruthClass;
    durationSec: number;
    meanDistanceM: number;
    peakMotion: number;
    postSpikeMotion?: number;
    breathStdMm: number;
    meanPresence: number;
    sonarSnrDb: number;
  };

  const predicted = classifyTrialFeatures({
    peakMotion,
    postSpikeMotion,
    breathStdMm,
    meanPresence,
  });

  const summary = addBenchmarkTrial({
    id: crypto.randomUUID(),
    timestampIso: new Date().toISOString(),
    expected,
    predicted,
    durationSec,
    meanDistanceM,
    peakMotion,
    breathStdMm,
    meanPresence,
    sonarSnrDb,
  });

  res.json({ predicted, summary });
});

app.delete('/api/benchmark', (_req, res) => {
  res.json(clearBenchmarkTrials());
});

const server = http.createServer(app);

// WebSocket Proxy: Browser 16kHz Int16 PCM -> Sarvam Saaras v4 Realtime WS (with automatic REST fallback)
const wss = new WebSocketServer({ server, path: '/ws/stt' });

wss.on('connection', (clientWs) => {
  if (sarvamStats.creditGuardLocked) {
    // Zero-credit local bypass: never open upstream Sarvam WebSocket while Credit Guard is locked!
    clientWs.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const ctrl = JSON.parse(data.toString()) as { type?: string };
          if (ctrl.type === 'finish_window' && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ event: 'window.complete' }));
          }
        } catch {
          // Ignore
        }
      }
    });
    return;
  }

  const apiKey = process.env.SARVAM_API_KEY || '';
  const pcmChunks: Buffer[] = [];
  let gotFinalTranscript = false;
  let partialLatest = '';
  const openedAt = Date.now();

  const upstreamUrl =
    'wss://api.sarvam.ai/speech-to-text-realtime/ws?language_code=ml-IN&model=saaras:v4&sample_rate=16000';

  const upstream = new WebSocket(upstreamUrl, {
    headers: { 'Api-Subscription-Key': apiKey },
  });

  sarvamStats.calls += 1;
  sarvamStats.byModel['saaras:v4'] = (sarvamStats.byModel['saaras:v4'] || 0) + 1;

  upstream.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        event?: string;
        text?: string;
        confidence?: number;
      };
      if (msg.event === 'transcript.partial' && msg.text) {
        partialLatest = msg.text;
      } else if (msg.event === 'transcript.final' && msg.text) {
        gotFinalTranscript = true;
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            ...msg,
            elapsedMs: Date.now() - openedAt,
          })
        );
      }
    } catch {
      // Ignore non-JSON frames
    }
  });

  upstream.on('error', (err) => {
    console.warn('[kaaval] Upstream Saaras WS warning:', err.message);
  });

  clientWs.on('message', async (data, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      pcmChunks.push(buf);
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(
          JSON.stringify({
            event: 'audio_input',
            audio: buf.toString('base64'),
          })
        );
      }
      return;
    }

    // Control message from browser (e.g., {"type":"finish_window"})
    try {
      const ctrl = JSON.parse(data.toString()) as { type?: string };
      if (ctrl.type === 'finish_window') {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(JSON.stringify({ event: 'speech_end' }));
        }
        // Wait up to 900ms for upstream final transcript; if missing & audio exists, run REST fallback
        setTimeout(async () => {
          if (!gotFinalTranscript && !partialLatest && pcmChunks.length > 8) {
            try {
              const fullPcm = Buffer.concat(pcmChunks);
              const fb = await transcribeFallbackRest(fullPcm);
              if (fb.transcript && clientWs.readyState === WebSocket.OPEN) {
                gotFinalTranscript = true;
                clientWs.send(
                  JSON.stringify({
                    event: 'transcript.final',
                    text: fb.transcript,
                    modelUsed: fb.trace.model,
                    elapsedMs: fb.trace.latencyMs,
                  })
                );
              }
            } catch (err) {
              console.warn('[kaaval] Fallback STT failed:', (err as Error).message);
            }
          }
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ event: 'window.complete' }));
          }
          upstream.close();
        }, 850);
      }
    } catch {
      // Ignore malformed control message
    }
  });

  clientWs.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  });
});

const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[kaaval-server] Listening on http://127.0.0.1:${PORT} (creditGuardLocked=${sarvamStats.creditGuardLocked})`);
  if (!sarvamStats.creditGuardLocked) {
    warmPromptCache();
  }
});
