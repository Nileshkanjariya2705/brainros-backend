import { AppLoggerService } from './logger.service';
import { RequestContext } from './request-context';
import { redactSensitiveData } from './logger.config';

describe('AppLoggerService', () => {
  let logger: AppLoggerService;

  beforeEach(() => {
    logger = new AppLoggerService();
  });

  it('should be defined', () => {
    expect(logger).toBeDefined();
  });

  describe('Sensitive Data Redaction', () => {
    it('should redact sensitive password and token fields', () => {
      const payload = {
        email: 'test@example.com',
        password: 'SuperSecretPassword123!',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        otp: '12345',
        nested: {
          refreshToken: 'refresh-secret-token',
          apiKey: 'secret-api-key',
        },
      };

      const redacted = redactSensitiveData(payload);
      expect(redacted.email).toBe('test@example.com');
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.otp).toBe('[REDACTED]');
      expect(redacted.nested.refreshToken).toBe('[REDACTED]');
      expect(redacted.nested.apiKey).toBe('[REDACTED]');
    });

    it('should redact credentials inside connection strings', () => {
      const dbUrl = 'postgresql://postgres:secretPass@localhost:5432/exam_db';
      const redacted = redactSensitiveData(dbUrl);
      expect(redacted).toBe('postgresql://postgres:****@localhost:5432/exam_db');
    });

    it('should redact Bearer authorization header strings', () => {
      const auth = 'Bearer secret-jwt-token-here';
      const redacted = redactSensitiveData(auth);
      expect(redacted).toBe('Bearer [REDACTED]');
    });
  });

  describe('RequestContext Enrichment', () => {
    it('should automatically attach requestId, userId, and role from RequestContext', () => {
      const spy = jest.spyOn((logger as any).pinoLogger, 'info').mockImplementation(() => {});

      RequestContext.run(
        {
          requestId: 'req-test-123',
          userId: 'usr-456',
          role: 'ADMIN',
        },
        () => {
          logger.log('Test message with ambient context', 'TestContext');
          expect(spy).toHaveBeenCalled();
          const loggedMeta = spy.mock.calls[0][0];
          expect(loggedMeta.requestId).toBe('req-test-123');
          expect(loggedMeta.userId).toBe('usr-456');
          expect(loggedMeta.role).toBe('ADMIN');
          expect(loggedMeta.context).toBe('TestContext');
        },
      );
    });
  });

  describe('Dedicated Structured Logging Helpers', () => {
    it('should log HTTP requests with status codes and duration', () => {
      const spy = jest.spyOn((logger as any).pinoLogger, 'info').mockImplementation(() => {});

      logger.logHttp({
        method: 'GET',
        path: '/api/v1/exams',
        statusCode: 200,
        durationMs: 45,
        userId: 'usr-1',
        requestId: 'req-1',
      });

      expect(spy).toHaveBeenCalled();
      const meta = spy.mock.calls[0][0];
      expect(meta.method).toBe('GET');
      expect(meta.path).toBe('/api/v1/exams');
      expect(meta.statusCode).toBe(200);
      expect(meta.durationMs).toBe(45);
    });

    it('should log worker queue events', () => {
      const spy = jest.spyOn((logger as any).pinoLogger, 'info').mockImplementation(() => {});

      logger.logWorker({
        queue: 'evaluation-queue',
        jobId: 'job-999',
        status: 'completed',
        attemptId: 'att-123',
        durationMs: 150,
      });

      expect(spy).toHaveBeenCalled();
      const meta = spy.mock.calls[0][0];
      expect(meta.queue).toBe('evaluation-queue');
      expect(meta.jobId).toBe('job-999');
      expect(meta.attemptId).toBe('att-123');
    });

    it('should log structured business events', () => {
      const spy = jest.spyOn((logger as any).pinoLogger, 'info').mockImplementation(() => {});

      logger.logEvent('EXAM_SUBMITTED', {
        examId: 'exam-101',
        studentId: 'stud-202',
      });

      expect(spy).toHaveBeenCalled();
      const meta = spy.mock.calls[0][0];
      expect(meta.event).toBe('EXAM_SUBMITTED');
      expect(meta.examId).toBe('exam-101');
    });
  });
});
