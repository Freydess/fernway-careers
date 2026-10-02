// Vercel function: POST /api/chat (logic in server/chat-handler.js).
import { handleChatRequest } from '../server/chat-handler.js';
import { toVercelFunction } from '../server/vercel.js';

export const POST = toVercelFunction(handleChatRequest);
