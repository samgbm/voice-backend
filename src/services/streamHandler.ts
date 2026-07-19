import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { env } from '../config/env';
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
    console.log('ElevenLabs connected');
    // Codec is controlled by the agent dashboard (set both to u-law 8000 for Twilio).
    // Websocket config overrides do not reliably change TTS/ASR formats.
    elevenLabsWs.send(
      JSON.stringify({
        type: 'conversation_initiation_client_data',
      })
    );
  });

  elevenLabsWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'conversation_initiation_metadata') {
        const meta = msg.conversation_initiation_metadata_event ?? {};
        agentOutputFormat = meta.agent_output_audio_format ?? null;
        userInputFormat = meta.user_input_audio_format ?? null;
        console.log('ElevenLabs audio formats', {
          agentOutputFormat,
          userInputFormat,
        });
        if (
          (agentOutputFormat && agentOutputFormat !== 'ulaw_8000') ||
          (userInputFormat && userInputFormat !== 'ulaw_8000')
        ) {
          console.warn(
            'Agent is not on ulaw_8000. Bridge will convert audio. ' +
              'For best quality, set BOTH TTS output and input to "u-law 8000" ' +
              'in the ElevenLabs agent dashboard.'
          );
        }
        return;
      }

      if (msg.type === 'ping') {
        const eventId = msg.ping_event?.event_id;
        if (eventId != null && elevenLabsWs.readyState === WebSocket.OPEN) {
          elevenLabsWs.send(
            JSON.stringify({ type: 'pong', event_id: eventId })
          );
        }
        return;
      }

      if (
        msg.type === 'interruption' &&
        streamSid &&
        twilioWs.readyState === WebSocket.OPEN
      ) {
        twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
        return;
      }

      if (msg.type !== 'audio') {
        return;
      }

      const audioPayload =
        msg.audio_event?.audio_base_64 ?? msg.audio ?? null;

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
      console.error('Failed to parse ElevenLabs message', err);
    }
  });

  elevenLabsWs.on('close', () => {
    console.log('ElevenLabs WebSocket closed');
    safeClose(twilioWs);
  });

  elevenLabsWs.on('error', (err) => {
    console.error('ElevenLabs WebSocket error', err);
    safeClose(twilioWs);
  });

  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log('Twilio stream started', streamSid);
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
        console.log('Twilio stream stopped');
        safeClose(elevenLabsWs);
      }
    } catch (err) {
      console.error('Failed to parse Twilio message', err);
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio WebSocket closed');
    safeClose(elevenLabsWs);
  });

  twilioWs.on('error', (err) => {
    console.error('Twilio WebSocket error', err);
    safeClose(elevenLabsWs);
  });
};
