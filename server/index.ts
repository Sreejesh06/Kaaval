import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 5443);
const VITE_DEV_PORT = Number(process.env.VITE_PORT || 5173);

function getLanIps(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const netIf of entries) {
      if (
        (netIf.family === 'IPv4' || (netIf.family as unknown) === 4) &&
        !netIf.internal &&
        netIf.address
      ) {
        ips.push(netIf.address);
      }
    }
  }
  return Array.from(new Set(ips));
}

function ensureLanTlsCert(lanIps: string[]): { key: Buffer; cert: Buffer } | null {
  try {
    const dataDir = path.resolve(process.cwd(), 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const keyPath = path.join(dataDir, 'lan-tls-key.pem');
    const certPath = path.join(dataDir, 'lan-tls-cert.pem');
    const metaPath = path.join(dataDir, 'lan-tls-ips.txt');
    const ipSig = ['127.0.0.1', ...lanIps].sort().join(',');

    if (
      !fs.existsSync(keyPath) ||
      !fs.existsSync(certPath) ||
      !fs.existsSync(metaPath) ||
      fs.readFileSync(metaPath, 'utf8').trim() !== ipSig
    ) {
      const sanEntries = ['DNS:localhost', 'IP:127.0.0.1', ...lanIps.map((ip) => `IP:${ip}`)].join(
        ','
      );
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-sha256',
          '-days',
          '365',
          '-subj',
          '/CN=kaaval-lan.local',
          '-addext',
          `subjectAltName=${sanEntries}`,
          '-keyout',
          keyPath,
          '-out',
          certPath,
        ],
        { stdio: 'ignore' }
      );
      fs.writeFileSync(metaPath, ipSig, 'utf8');
    }

    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  } catch (err) {
    console.warn('[kaaval] Could not auto-generate LAN HTTPS cert:', (err as Error).message);
    return null;
  }
}

type HubClientRole = 'room' | 'caregiver' | 'satellite' | 'unknown';

const hubClients = new Map<
  WebSocket,
  {
    role: HubClientRole;
    connectedAt: number;
    satArmed?: boolean;
    satTelemetry?: unknown;
  }
>();
let latestRoomTelemetry: unknown = null;

function getActiveSatelliteState() {
  let connected = false;
  let armed = false;
  let latestTelemetry: unknown = null;
  for (const meta of hubClients.values()) {
    if (meta.role === 'satellite') {
      connected = true;
      if (meta.satArmed) armed = true;
      if (meta.satTelemetry) latestTelemetry = meta.satTelemetry;
    }
  }
  return { connected, armed, telemetry: latestTelemetry };
}

function broadcastSatelliteStatus() {
  const st = getActiveSatelliteState();
  broadcastHub({
    type: 'satellite_status',
    connected: st.connected,
    armed: st.armed,
    telemetry: st.telemetry,
  });
}

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
    httpsPort: HTTPS_PORT,
    httpsReady: httpsGatewayReady,
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

let httpsGatewayReady = false;
const server = http.createServer(app);

const sttWss = new WebSocketServer({ noServer: true });
const hubWss = new WebSocketServer({ noServer: true });

function handleLocalWsUpgrade(
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer
): boolean {
  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  } catch {
    return false;
  }

  if (pathname === '/ws/stt') {
    sttWss.handleUpgrade(req, socket, head, (ws) => {
      sttWss.emit('connection', ws, req);
    });
    return true;
  }

  if (pathname === '/ws/hub') {
    hubWss.handleUpgrade(req, socket, head, (ws) => {
      hubWss.emit('connection', ws, req);
    });
    return true;
  }

  return false;
}

server.on('upgrade', (req, socket, head) => {
  if (!handleLocalWsUpgrade(req, socket as net.Socket, head)) {
    socket.destroy();
  }
});

hubWss.on('connection', (clientWs, req) => {
  let initialRole: HubClientRole = 'unknown';
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const roleParam = parsedUrl.searchParams.get('role');
    if (roleParam === 'room' || roleParam === 'caregiver' || roleParam === 'satellite') {
      initialRole = roleParam;
    }
  } catch {
    initialRole = 'unknown';
  }

  const meta: {
    role: HubClientRole;
    connectedAt: number;
    satArmed?: boolean;
    satTelemetry?: unknown;
  } = { role: initialRole, connectedAt: Date.now(), satArmed: false };
  hubClients.set(clientWs, meta);

  if (latestRoomTelemetry !== null && clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify({ type: 'room_telemetry', data: latestRoomTelemetry }));
  }

  if (initialRole === 'satellite') {
    broadcastSatelliteStatus();
  } else if (clientWs.readyState === WebSocket.OPEN) {
    const satState = getActiveSatelliteState();
    clientWs.send(
      JSON.stringify({
        type: 'satellite_status',
        connected: satState.connected,
        armed: satState.armed,
        telemetry: satState.telemetry,
      })
    );
  }

  clientWs.on('message', (raw, isBinary) => {
    if (isBinary) return;
    try {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        role?: string;
        paused?: boolean;
        data?: { armed?: boolean } & Record<string, unknown>;
      };

      if (msg.type === 'register' || msg.type === 'hello') {
        if (msg.role === 'room' || msg.role === 'caregiver' || msg.role === 'satellite') {
          meta.role = msg.role;
          if (msg.role === 'satellite') broadcastSatelliteStatus();
        }
        return;
      }

      if (msg.type === 'room_telemetry') {
        meta.role = 'room';
        latestRoomTelemetry = msg.data ?? null;
        broadcastHub({ type: 'room_telemetry', data: msg.data }, clientWs);
        return;
      }

      if (msg.type === 'satellite_telemetry' && msg.data) {
        const prevArmed = Boolean(meta.satArmed);
        meta.role = 'satellite';
        meta.satArmed = Boolean(msg.data.armed);
        meta.satTelemetry = msg.data;
        broadcastHub({ type: 'satellite_telemetry', data: msg.data }, clientWs);
        if (prevArmed !== meta.satArmed) {
          broadcastSatelliteStatus();
        }
        return;
      }

      if (msg.type === 'room_voice_gate') {
        // Pause/resume satellite ultrasonic chirp cleanly during Malayalam TTS/STT window
        const payload = JSON.stringify({
          type: 'room_voice_gate',
          paused: Boolean(msg.paused),
        });
        for (const [peer, peerMeta] of hubClients.entries()) {
          if (peerMeta.role === 'satellite' && peer.readyState === WebSocket.OPEN) {
            peer.send(payload);
          }
        }
      }
    } catch {
      // Ignore malformed JSON frames
    }
  });

  clientWs.on('close', () => {
    const wasSat = meta.role === 'satellite';
    hubClients.delete(clientWs);
    if (wasSat) broadcastSatelliteStatus();
  });

  clientWs.on('error', () => {
    const wasSat = meta.role === 'satellite';
    hubClients.delete(clientWs);
    if (wasSat) broadcastSatelliteStatus();
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

// Start Secure HTTPS + WSS Satellite Gateway on :5443 so POCO M2 Pro (Android Chrome) unlocks getUserMedia!
const tlsCreds = ensureLanTlsCert(getLanIps());
if (tlsCreds) {
  const httpsServer = https.createServer(tlsCreds, (req, res) => {
    const urlStr = req.url || '/';
    if (urlStr.startsWith('/api/')) {
      app(req, res);
      return;
    }

    // Reverse-proxy frontend & AudioWorklet requests to Vite dev server (:5173)
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: VITE_DEV_PORT,
        path: urlStr,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${VITE_DEV_PORT}`,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Kaaval HTTPS Gateway: start Vite client (`npm run dev:client`) on port 5173.');
    });

    req.pipe(proxyReq);
  });

  httpsServer.on('upgrade', (req, socket, head) => {
    const netSock = socket as net.Socket;
    if (handleLocalWsUpgrade(req, netSock, head)) {
      return;
    }

    // Tunnel Vite HMR WebSockets transparently over WSS
    const upstream = net.connect(VITE_DEV_PORT, '127.0.0.1', () => {
      const reqLines = [`${req.method || 'GET'} ${req.url || '/'} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        reqLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      reqLines.push('', '');
      upstream.write(reqLines.join('\r\n'));
      if (head && head.length > 0) upstream.write(head);
      upstream.pipe(netSock);
      netSock.pipe(upstream);
    });

    upstream.on('error', () => netSock.destroy());
    netSock.on('error', () => upstream.destroy());
  });

  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    httpsGatewayReady = true;
    const lanIps = getLanIps();
    const satUrl =
      lanIps.length > 0
        ? `https://${lanIps[0]}:${HTTPS_PORT}/satellite`
        : `https://localhost:${HTTPS_PORT}/satellite`;
    console.log(`[kaaval-https] POCO M2 Pro Satellite Sonar ready at ${satUrl}`);
  });

  httpsServer.on('error', (err) => {
    console.warn('[kaaval-https] Port 5443 unavailable:', err.message);
  });
}
