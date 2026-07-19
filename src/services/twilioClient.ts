import { env } from '../config/env';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const client = require('twilio')(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

export default client;
