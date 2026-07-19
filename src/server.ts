import { env } from './config/env';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import dispatchRouter from './routes/dispatch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/dispatch', dispatchRouter);

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

const PORT = env.PORT || process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Voice orchestrator listening on port ${PORT}`);
});
