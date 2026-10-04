// Vercel function: POST /api/apply (logic in server/apply-handler.js).
import { handleApplyRequest } from '../server/apply-handler.js';
import { toVercelFunction } from '../server/vercel.js';

// Room for a sleeping backend to wake up (see BACKEND_TIMEOUT_MS). 60s is the Hobby plan's limit without Fluid compute.
export const maxDuration = 60;

export const POST = toVercelFunction(handleApplyRequest);
