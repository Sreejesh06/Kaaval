import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CHECKIN_PROMPTS,
  sarvamStats,
  synthesizeCaregiverBridge,
  synthesizeMalayalam,
  transcribeFallbackRest,
  triageCheckinResponse,
  warmPromptCache,
} from './sarvam.js';
import {
  addBenchmarkTrial,
  appendCaregiverReply,
  appendIncident,
  classifyTrialFeatures,
  clearBenchmarkTrials,
  computeBenchmarkSummary,
  listIncidents,
} from './trialsStore.js';
import type {
  AnomalyTriggerReason,
  CaregiverReply,
  GroundTruthClass,
  IncidentRecord,
} from '../src/types.js';

const PORT = Number(process.env.PORT || 3001);

function getLanIps(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if ((net.family === 'IPv4' || (net.family as unknown) === 4) && !net.internal && net.address) {
        ips.push(net.address);
      }
    }
  }
  return Array.from(new Set(ips));
}

type HubClientRole = 'room' | 'caregiver' | 'unknown';

const hubClients = new Map<WebSocket, { role: HubClientRole; connectedAt: number }>();
let latestRoomTelemetry: unknown = null;

function broadcastHub(payload: unknown, excludeClient?: WebSocket) {
  const serialized = JSON.stringify(payload);
  for (const client of hubClients.keys()) {
    if (client === excludeClient) continue;
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }
}

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

app.get('/api/lan-info', (_req, res) => {
  res.json({
    lanIps: getLanIps(),
    port: PORT,
  });
});

app.post('/api/credit-guard', (req, res) => {
  sarvamStats.creditGuardLocked = Boolean(req.body?.locked);
  res.json({ creditGuardLocked: sarvamStats.creditGuardLocked, sarvamStats });
});

app.get('/api/prompt-audio', async (req, res) => {
  const trigger = (req.query.trigger as AnomalyTriggerReason) || 'FALL_IMPACT_AND_STILLNESS';
  const promptMl = CHECKIN_PROMPTS[trigger] || CHECKIN_PROMPTS.FALL_IMPACT_AND_STILLNESS;
  try {
    const { audioBase64, trace } = await synthesizeMalayalam(promptMl);
    res.json({ promptMl, audioBase64, trace });
  } catch (err) {
    res.json({
      promptMl,
      audioBase64: '',
      trace: {
        model: 'OFFLINE-CHIME-ONLY',
        endpoint: 'LOCAL FALLBACK',
        latencyMs: 0,
        detail: (err as Error).message,
      },
    });
  }
});

app.post('/api/triage', async (req, res) => {
  try {
    const {
      trigger,
      transcriptMl,
      distanceMeters,
      azimuthDeg,
      snapshotDataUrl,
      peakMotionEnergy,
      respirationBpmBefore,
      sttLatencyMs,
      sttModelUsed,
    } = req.body as {
      trigger: AnomalyTriggerReason;
      transcriptMl: string;
      distanceMeters: number;
      azimuthDeg?: number;
      snapshotDataUrl?: string;
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
      ...(typeof azimuthDeg === 'number' && Number.isFinite(azimuthDeg) ? { azimuthDeg } : {}),
      ...(typeof snapshotDataUrl === 'string' && snapshotDataUrl.length > 0
        ? { snapshotDataUrl }
        : {}),
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
      ...(result.offlineFallback ? { offlineFallback: true } : {}),
    };

    const incidents = appendIncident(record);
    broadcastHub({ type: 'incident_created', record, incidents });
    res.json({ record, incidents, sarvamStats });
  } catch (err) {
    console.error('[kaaval] /api/triage error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/caregiver-reply', async (req, res) => {
  try {
    const { incidentId, message, sourceLang } = (req.body || {}) as {
      incidentId?: string;
      message?: string;
      sourceLang?: 'en-IN' | 'ml-IN' | 'hi-IN';
    };

    const messageInput = (message || '').trim();
    if (!messageInput) {
      res.status(400).json({ error: 'Caregiver message is required' });
      return;
    }

    const resolvedLang: 'en-IN' | 'ml-IN' | 'hi-IN' =
      sourceLang === 'ml-IN' || sourceLang === 'hi-IN' || sourceLang === 'en-IN'
        ? sourceLang
        : 'en-IN';

    const startedAt = Date.now();
    const { spokenMalayalam, audioBase64, traces } = await synthesizeCaregiverBridge(
      messageInput,
      resolvedLang
    );

    const reply: CaregiverReply = {
      id: crypto.randomUUID(),
      timestampIso: new Date().toISOString(),
      messageInput,
      sourceLang: resolvedLang,
      spokenMalayalam,
      latencyMs: Date.now() - startedAt,
    };

    const incidents = appendCaregiverReply(incidentId, reply);
    broadcastHub({
      type: 'caregiver_reassurance',
      reply,
      audioBase64,
      traces,
      incidents,
    });

    res.json({ ok: true, reply, incidents });
  } catch (err) {
    console.error('[kaaval] /api/caregiver-reply error:', err);
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

const sttWss = new WebSocketServer({ noServer: true });
const hubWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname === '/ws/stt') {
    sttWss.handleUpgrade(req, socket, head, (ws) => {
      sttWss.emit('connection', ws, req);
    });
    return;
  }

  if (pathname === '/ws/hub') {
    hubWss.handleUpgrade(req, socket, head, (ws) => {
      hubWss.emit('connection', ws, req);
    });
    return;
  }

  socket.destroy();
});

hubWss.on('connection', (clientWs, req) => {
  let initialRole: HubClientRole = 'unknown';
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const roleParam = parsedUrl.searchParams.get('role');
    if (roleParam === 'room' || roleParam === 'caregiver') {
      initialRole = roleParam;
    }
  } catch {
    initialRole = 'unknown';
  }

  const meta = { role: initialRole, connectedAt: Date.now() };
  hubClients.set(clientWs, meta);

  if (latestRoomTelemetry !== null && clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify({ type: 'room_telemetry', data: latestRoomTelemetry }));
  }

  clientWs.on('message', (raw, isBinary) => {
    if (isBinary) return;
    try {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        role?: string;
        data?: unknown;
      };

      if (msg.type === 'register' || msg.type === 'hello') {
        if (msg.role === 'room' || msg.role === 'caregiver') {
          meta.role = msg.role;
        }
        return;
      }

      if (msg.type === 'room_telemetry') {
        meta.role = 'room';
        latestRoomTelemetry = msg.data ?? null;
        broadcastHub({ type: 'room_telemetry', data: msg.data }, clientWs);
      }
    } catch {
      // Ignore malformed JSON frames
    }
  });

  clientWs.on('close', () => {
    hubClients.delete(clientWs);
  });

  clientWs.on('error', () => {
    hubClients.delete(clientWs);
  });
});

sttWss.on('connection', (clientWs) => {
  if (sarvamStats.creditGuardLocked) {
    clientWs.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const ctrl = JSON.parse(data.toString()) as { type?: string };
          if (ctrl.type === 'finish_window' && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ event: 'window.complete' }));
          }
        } catch {
          // Ignore malformed control message
        }
      }
    });
    return;
  }

  const apiKey = process.env.SARVAM_API_KEY || '';
  const pcmChunks: Buffer[] = [];
  const pendingQueue: Buffer[] = [];
  let finishPendingOnOpen = false;
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

  upstream.on('open', () => {
    while (pendingQueue.length > 0 && upstream.readyState === WebSocket.OPEN) {
      const queuedChunk = pendingQueue.shift();
      if (queuedChunk) {
        upstream.send(
          JSON.stringify({
            event: 'audio_input',
            audio: queuedChunk.toString('base64'),
          })
        );
      }
    }
    if (finishPendingOnOpen && upstream.readyState === WebSocket.OPEN) {
      upstream.send(JSON.stringify({ event: 'speech_end' }));
    }
  });

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
      const buf = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
      pcmChunks.push(buf);
      if (upstream.readyState === WebSocket.CONNECTING) {
        pendingQueue.push(buf);
      } else if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(
          JSON.stringify({
            event: 'audio_input',
            audio: buf.toString('base64'),
          })
        );
      }
      return;
    }

    try {
      const ctrl = JSON.parse(data.toString()) as { type?: string };
      if (ctrl.type === 'finish_window') {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(JSON.stringify({ event: 'speech_end' }));
        } else if (upstream.readyState === WebSocket.CONNECTING) {
          finishPendingOnOpen = true;
        }
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
          if (
            upstream.readyState === WebSocket.OPEN ||
            upstream.readyState === WebSocket.CONNECTING
          ) {
            upstream.close();
          }
        }, 850);
      }
    } catch {
      // Ignore malformed control message
    }
  });

  clientWs.on('close', () => {
    pendingQueue.length = 0;
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLanIps();
  const lanHint = lanIps.length > 0 ? ` | LAN: http://${lanIps[0]}:${PORT}` : '';
  console.log(
    `[kaaval-server] Listening on http://0.0.0.0:${PORT}${lanHint} (creditGuardLocked=${sarvamStats.creditGuardLocked})`
  );
  if (!sarvamStats.creditGuardLocked) {
    warmPromptCache();
  }
});
