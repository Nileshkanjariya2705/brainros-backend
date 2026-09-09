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
import { PrismaService } from '../../prisma/prisma.service';
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

  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

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
      const userId = payload.sub || payload.userId;

      // Authoritative database resolution of user roles
      let roles: string[] = [];
      let institutionId = payload.institutionId;

      try {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          include: {
            userRoles: {
              include: { role: true },
            },
          },
        });
        if (user) {
          roles = user.userRoles?.map((ur) => ur.role.name) || [];
        }
      } catch (dbErr: any) {
        this.logger.warn(`Failed to fetch database roles for socket user ${userId}: ${dbErr.message}`);
      }

      if (roles.length === 0 && (payload.roles || payload.role)) {
        roles = payload.roles || [payload.role];
      }

      socket.user = {
        userId,
        roles,
        institutionId,
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

  @SubscribeMessage('subscribe_exam_jobs')
  async handleSubscribeExamJobs(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { examId?: string },
  ) {
    if (!socket.user) {
      throw new UnauthorizedException('Socket connection is not authenticated.');
    }

    const roles = socket.user.roles || [];
    const isAuthorized = roles.some((r) => {
      const upper = String(r).toUpperCase().trim();
      return (
        upper === 'SUPER_ADMIN' ||
        upper === 'ADMIN' ||
        upper === 'INSTITUTION_ADMIN' ||
        upper.includes('ADMIN')
      );
    });

    if (!isAuthorized) {
      this.logger.warn(
        `[WebSocket] Unauthorized exam job subscription attempt by user ${socket.user.userId} with roles: [${roles.join(', ')}]`,
      );
      return { status: 'error', message: 'Forbidden: Insufficient privileges for exam monitoring' };
    }

    if (!data?.examId) {
      return { status: 'error', message: 'examId is required' };
    }

    const roomName = `exam:${data.examId}`;
    socket.join(roomName);

    this.logger.log(
      `[WebSocket] Administrator ${socket.user.userId} subscribed to exam room ${roomName}`,
    );

    return { status: 'ok', subscribed: roomName };
  }

  @SubscribeMessage('unsubscribe_exam_jobs')
  async handleUnsubscribeExamJobs(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { examId?: string },
  ) {
    if (!data?.examId) {
      return { status: 'error', message: 'examId is required' };
    }

    const roomName = `exam:${data.examId}`;
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

    // Broadcast to exam room if examId is present
    if (event.job.examId) {
      const examRoom = `exam:${event.job.examId}`;
      this.server.to(examRoom).emit('job.event', event);
      this.server.to(examRoom).emit(event.event, event);
    }
  }

  /**
   * Dedicated broadcast for exam result processing completion and publication readiness.
   */
  emitExamCompletion(examId: string, status: string = 'READY_TO_PUBLISH') {
    if (!this.server) return;
    const payload = { examId, status, timestamp: new Date().toISOString() };
    this.server.to(`exam:${examId}`).emit('exam.result.processing.completed', payload);
    this.server.emit('exam.result.processing.completed', payload);
  }
}
