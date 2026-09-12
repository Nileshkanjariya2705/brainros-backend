import {
  Controller,
  Post,
  Req,
  Res,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { RedisService } from '../../redis/redis.service';
import * as crypto from 'crypto';
import type { Request, Response } from 'express';

@Controller('payments/razorpay')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * POST /payments/razorpay/webhook
   * Asynchronous Razorpay webhook handler for payment events with raw body signature verification and event idempotency.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
    @Headers('x-razorpay-signature') signature: string,
    @Headers('x-razorpay-event-id') eventId: string,
  ) {
    const webhookSecret =
      this.configService.get('RAZORPAY_WEBHOOK_SECRET') ||
      'whsec_brainros_razorpay_secret_2026';

    // 1. Verify Webhook Signature using unparsed raw request body Buffer
    const rawBody = req.rawBody || (req as any).body;
    const bodyBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : typeof rawBody === 'string'
        ? Buffer.from(rawBody)
        : Buffer.from(JSON.stringify(rawBody || {}));

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(bodyBuffer)
      .digest('hex');

    if (!signature || signature !== expectedSignature) {
      this.logger.warn(`Razorpay Webhook signature verification failed for event ${eventId || 'unknown'}`);
      return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Invalid webhook signature' });
    }

    // 2. Idempotency Check via x-razorpay-event-id
    if (eventId) {
      const alreadyProcessed = await this.redisService.get(`webhook_processed:${eventId}`);
      if (alreadyProcessed) {
        this.logger.log(`Webhook event ${eventId} already processed. Returning OK.`);
        return res.status(HttpStatus.OK).json({ status: 'ok', duplicated: true });
      }
      await this.redisService.set(`webhook_processed:${eventId}`, '1', 86400); // 24 hours TTL
    }

    // 3. Process Webhook Event Payload
    const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : req.body;
    const event = payload?.event;
    this.logger.log(`Received Razorpay webhook event: ${event}`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentObj = payload.payload?.payment?.entity;
      const orderObj = payload.payload?.order?.entity;

      const razorpayPaymentId = paymentObj?.id;
      const razorpayOrderId = paymentObj?.order_id || orderObj?.id;
      const registrationId =
        paymentObj?.notes?.registrationId || orderObj?.notes?.registrationId;

      if (registrationId && razorpayOrderId) {
        try {
          const rawData = await this.redisService.get(`registration:${registrationId}`);
          if (rawData) {
            const registration = JSON.parse(rawData);
            await this.authService.finalizeStudentRegistration(
              registration,
              razorpayOrderId,
              razorpayPaymentId || `pay_wh_${Date.now()}`,
              signature || 'webhook_verified',
              { ip: req.ip, userAgent: req.headers['user-agent'] },
            );
            this.logger.log(`Webhook finalized registration ${registrationId} successfully.`);
          }
        } catch (err: any) {
          this.logger.error(`Webhook registration finalization error: ${err.message}`);
        }
      }
    }

    return res.status(HttpStatus.OK).json({ status: 'ok' });
  }
}
