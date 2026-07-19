import { env } from './config/env';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import dispatchRouter from './routes/dispatch';
import { handleTwilioStream } from './services/streamHandler';

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
  if (req.url?.split('?')[0] === '/twilio/stream') {
    handleTwilioStream(ws, req);
    return;
  }
  ws.close();
});

const PORT = env.PORT || process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Voice orchestrator listening on port ${PORT}`);
});
