import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().min(1, 'TWILIO_ACCOUNT_SID is required'),
  TWILIO_AUTH_TOKEN: z.string().min(1, 'TWILIO_AUTH_TOKEN is required'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Missing or invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'voice-orchestrator' });
});

app.post('/twilio/outbound', (req, res) => {
  res.type('text/xml');
  res.send(
    '<Response><Connect><Stream url="wss://' +
      req.headers.host +
      '/twilio/stream" /></Connect></Response>'
  );
});

wss.on('connection', (ws, req) => {
  const path = req.url?.split('?')[0];
  if (path !== '/twilio/stream') {
    ws.close();
    return;
  }

  console.log('Twilio Media Stream connected');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(msg.event);

      if (msg.event === 'start') {
        console.log(msg.start.streamSid);
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message', err);
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Voice orchestrator listening on port ${PORT}`);
});
