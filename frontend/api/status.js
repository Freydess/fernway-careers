// Vercel function: GET /api/status (logic in server/status-handler.js).
import { handleStatusRequest } from '../server/status-handler.js';
import { toVercelFunction } from '../server/vercel.js';

export const GET = toVercelFunction(handleStatusRequest);
