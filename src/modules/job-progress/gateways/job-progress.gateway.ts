import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards, UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../../auth/services/token.service';
import {
  JobProgressEventDto,
  SubscribeJobPayload,
} from '../dto/job-progress.dto';

interface AuthenticatedSocket extends Socket {
  user?: {
    userId: string;
    roles?: string[];
    institutionId?: string;
  };
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/ws/jobs',
})
export class JobProgressGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(JobProgressGateway.name);

  constructor(private readonly tokenService: TokenService) {}

  async handleConnection(socket: AuthenticatedSocket) {
    try {
      const authHeader =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        socket.handshake.headers?.cookie;

      let token: string | undefined;

      if (authHeader && typeof authHeader === 'string') {
        if (authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7);
        } else if (!authHeader.includes('=')) {
          token = authHeader;
        } else {
          // Parse cookie if passed
          const match = authHeader.match(/access_token=([^;]+)/);
          if (match) {
            token = match[1];
          }
        }
      }

      if (!token) {
        this.logger.warn(
          `[WebSocket] Connection rejected: No token provided (${socket.id})`,
        );
        socket.disconnect(true);
        return;
      }

      const payload = await this.tokenService.verifyAccessToken(token);
      socket.user = {
        userId: payload.sub || payload.userId,
        roles: payload.roles || (payload.role ? [payload.role] : []),
        institutionId: payload.institutionId,
      };

      // Auto-join personal user channel
      socket.join(`user:${socket.user.userId}`);

      this.logger.log(
        `[WebSocket] Client connected & authenticated: ${socket.user.userId} (${socket.id})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `[WebSocket] Authentication failed for socket ${socket.id}: ${err.message}`,
      );
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: AuthenticatedSocket) {
    this.logger.log(`[WebSocket] Client disconnected: ${socket.id}`);
  }

  @SubscribeMessage('subscribe_job')
  async handleSubscribeJob(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { queue?: string; jobId?: string },
  ) {
    if (!socket.user) {
      throw new UnauthorizedException('Socket connection is not authenticated.');
    }

    if (!data?.queue || !data?.jobId) {
      return { status: 'error', message: 'Queue and jobId are required' };
    }

    const roomName = `job:${data.queue}:${data.jobId}`;
    socket.join(roomName);

    this.logger.log(
      `[WebSocket] User ${socket.user.userId} subscribed to room ${roomName}`,
    );

    return { status: 'ok', subscribed: roomName };
  }

  @SubscribeMessage('unsubscribe_job')
  async handleUnsubscribeJob(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { queue?: string; jobId?: string },
  ) {
    if (!data?.queue || !data?.jobId) {
      return { status: 'error', message: 'Queue and jobId are required' };
    }

    const roomName = `job:${data.queue}:${data.jobId}`;
    socket.leave(roomName);

    return { status: 'ok', unsubscribed: roomName };
  }

  /**
   * Broadcasts job progress event to authorized subscription rooms.
   */
  emitJobProgress(event: JobProgressEventDto) {
    if (!this.server) return;

    const roomName = `job:${event.job.queue}:${event.job.jobId}`;

    // Broadcast to specific job room
    this.server.to(roomName).emit('job.event', event);
    this.server.to(roomName).emit(event.event, event);

    // If job belongs to a specific user, emit to user channel as well
    if (event.job.userId) {
      const userRoom = `user:${event.job.userId}`;
      this.server.to(userRoom).emit('job.event', event);
      this.server.to(userRoom).emit(event.event, event);
    }
  }
}
