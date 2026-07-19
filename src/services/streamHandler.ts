import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { toElevenLabsUserAudio, toTwilioMulawPayload } from './audioCodec';

function safeClose(ws: WebSocket): void {
  if (
    ws.readyState === WebSocket.OPEN ||
    ws.readyState === WebSocket.CONNECTING
  ) {
    try {
      ws.close();
    } catch {
      // ignore close errors
    }
  }
}

export const handleTwilioStream = (twilioWs: WebSocket, _req: IncomingMessage) => {
  let streamSid: string | null = null;
  let agentOutputFormat: string | null = null;
  let userInputFormat: string | null = null;

  const elevenLabsWs = new WebSocket(
    `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${env.ELEVENLABS_AGENT_ID}`
  );

  elevenLabsWs.on('open', () => {
    logger.info('ElevenLabs connected');
    // Codec is controlled by the agent dashboard (set both to u-law 8000 for Twilio).
    // Websocket config overrides do not reliably change TTS/ASR formats.
    elevenLabsWs.send(
      JSON.stringify({
        type: 'conversation_initiation_client_data',
      })
    );
  });

  elevenLabsWs.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === 'agent_response') {
        logger.info(
          { text: data.agent_response_event.agent_response },
          '🤖 AGENT SPEAKING'
        );
      }

      if (data.type === 'user_transcript') {
        logger.info(
          { text: data.user_transcription_event.user_transcript },
          '👤 USER SPEAKING'
        );
      }

      if (data.type === 'interruption') {
        logger.warn('⚠️ BARGE-IN DETECTED: Agent Interrupted by User');
        if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
        }
        return;
      }

      if (data.type === 'conversation_initiation_metadata') {
        const meta = data.conversation_initiation_metadata_event ?? {};
        agentOutputFormat = meta.agent_output_audio_format ?? null;
        userInputFormat = meta.user_input_audio_format ?? null;
        logger.info(
          { agentOutputFormat, userInputFormat },
          'ElevenLabs audio formats'
        );
        if (
          (agentOutputFormat && agentOutputFormat !== 'ulaw_8000') ||
          (userInputFormat && userInputFormat !== 'ulaw_8000')
        ) {
          logger.warn(
            'Agent is not on ulaw_8000. Bridge will convert audio. ' +
              'For best quality, set BOTH TTS output and input to "u-law 8000" ' +
              'in the ElevenLabs agent dashboard.'
          );
        }
        return;
      }

      if (data.type === 'ping') {
        const eventId = data.ping_event?.event_id;
        if (eventId != null && elevenLabsWs.readyState === WebSocket.OPEN) {
          elevenLabsWs.send(
            JSON.stringify({ type: 'pong', event_id: eventId })
          );
        }
        return;
      }

      if (data.type !== 'audio') {
        return;
      }

      const audioPayload =
        data.audio_event?.audio_base_64 ?? data.audio ?? null;

      if (audioPayload && streamSid && twilioWs.readyState === WebSocket.OPEN) {
        const payload = toTwilioMulawPayload(audioPayload, agentOutputFormat);
        twilioWs.send(
          JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload },
          })
        );
      }
    } catch (err) {
      logger.error({ err }, 'Failed to parse ElevenLabs message');
    }
  });

  elevenLabsWs.on('close', () => {
    logger.info('ElevenLabs WebSocket closed');
    safeClose(twilioWs);
  });

  elevenLabsWs.on('error', (err) => {
    logger.error({ err }, 'ElevenLabs WebSocket error');
    safeClose(twilioWs);
  });

  twilioWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        logger.info({ streamSid }, 'Twilio stream started');
        return;
      }

      if (msg.event === 'media') {
        if (elevenLabsWs.readyState === WebSocket.OPEN) {
          const chunk = toElevenLabsUserAudio(
            msg.media.payload,
            userInputFormat
          );
          elevenLabsWs.send(JSON.stringify({ user_audio_chunk: chunk }));
        }
        return;
      }

      if (msg.event === 'stop') {
        logger.info('Twilio stream stopped');
        safeClose(elevenLabsWs);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to parse Twilio message');
    }
  });

  twilioWs.on('close', () => {
    logger.info('Twilio WebSocket closed');
    safeClose(elevenLabsWs);
  });

  twilioWs.on('error', (err) => {
    logger.error({ err }, 'Twilio WebSocket error');
    safeClose(elevenLabsWs);
  });
};
