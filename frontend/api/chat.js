// Vercel function: POST /api/chat (logic in server/chat-handler.js).
import { handleChatRequest } from '../server/chat-handler.js';
import { toVercelFunction } from '../server/vercel.js';

// Room for one retry of a 25s AI call (see chat-handler.js).
export const maxDuration = 60;

export const POST = toVercelFunction(handleChatRequest);
