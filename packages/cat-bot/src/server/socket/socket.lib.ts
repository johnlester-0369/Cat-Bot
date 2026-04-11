/**
 * Socket.IO Server Singleton
 *
 * Owns the single Socket.IO Server instance for the entire process.
 * Attaches to the Node.js HTTP server (not Express) so socket.io intercepts
 * WebSocket upgrade events before Express ever sees the request.
 *
 * initSocketIO() must be called once in server.ts after createServer(app)
 * and before httpServer.listen(). All other modules call getSocketIO() to
 * emit events without needing to pass the instance through the call chain.
 */

import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';

let io: SocketIOServer | null = null;

/**
 * Creates and stores the Socket.IO Server, binding it to the provided HTTP server.
 * CORS origin must match Express CORS config so browser preflight is satisfied.
 */
export function initSocketIO(
  httpServer: HttpServer,
  corsOrigin: string | string[] | boolean,
): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });
  return io;
}

/**
 * Returns the Socket.IO Server instance or null when not yet initialised.
 * Callers (validation.socket.ts) must guard against null for safety.
 */
export function getSocketIO(): SocketIOServer | null {
  return io;
}
