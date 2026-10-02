// Vercel function: POST /api/apply (logic in server/apply-handler.js).
import { handleApplyRequest } from '../server/apply-handler.js';
import { toVercelFunction } from '../server/vercel.js';

export const POST = toVercelFunction(handleApplyRequest);
