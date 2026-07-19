import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import twilioClient from '../services/twilioClient';

const dispatchRouter = Router();

const dispatchSchema = z.object({
  jobSpecId: z.string().min(1),
  vendorNumbers: z.array(z.string()),
});

dispatchRouter.post('/', async (req, res) => {
  const parsed = dispatchSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid payload',
      details: parsed.error.issues,
    });
  }

  const { jobSpecId, vendorNumbers } = parsed.data;

  if (vendorNumbers.length === 0) {
    return res.status(400).json({ error: 'vendorNumbers must not be empty' });
  }

  const results = await Promise.allSettled(
    vendorNumbers.map((to) =>
      twilioClient.calls.create({
        to,
        from: env.TWILIO_PHONE_NUMBER,
        url: `${env.BASE_URL}/twilio/outbound`,
        machineDetection: 'Enable',
      })
    )
  );
  console.log(`${env.BASE_URL}/twilio/outbound`);
  console.log(results);
  const successful: Array<{ to: string; callSid: string; jobSpecId: string }> = [];
  const failed: Array<{ to: string; error: string; jobSpecId: string }> = [];

  results.forEach((result, index) => {
    const to = vendorNumbers[index];
    if (result.status === 'fulfilled') {
      successful.push({
        to,
        callSid: result.value.sid,
        jobSpecId,
      });
    } else {
      const reason = result.reason;
      failed.push({
        to,
        error: reason instanceof Error ? reason.message : String(reason),
        jobSpecId,
      });
    }
  });

  return res.json({
    jobSpecId,
    successful,
    failed,
    summary: {
      total: vendorNumbers.length,
      succeeded: successful.length,
      failed: failed.length,
    },
  });
});

export default dispatchRouter;
