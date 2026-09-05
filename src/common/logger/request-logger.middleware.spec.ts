import { RequestLoggerMiddleware } from './request-logger.middleware';
import { AppLoggerService } from './logger.service';

describe('RequestLoggerMiddleware', () => {
  let middleware: RequestLoggerMiddleware;
  let loggerService: AppLoggerService;

  beforeEach(() => {
    loggerService = new AppLoggerService();
    middleware = new RequestLoggerMiddleware(loggerService);
  });

  it('should generate a UUID requestId when none is provided in headers', () => {
    const req: any = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      method: 'GET',
      url: '/api/v1/students',
    };
    const res: any = {
      setHeader: jest.fn(),
      on: jest.fn(),
    };
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.id).toBeDefined();
    expect(typeof req.id).toBe('string');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
    expect(next).toHaveBeenCalled();
  });

  it('should reuse valid client-provided X-Request-ID', () => {
    const customId = 'client-req-id-12345678';
    const req: any = {
      headers: { 'x-request-id': customId },
      socket: { remoteAddress: '127.0.0.1' },
      method: 'POST',
      url: '/api/v1/exams',
    };
    const res: any = {
      setHeader: jest.fn(),
      on: jest.fn(),
    };
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.id).toBe(customId);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', customId);
    expect(next).toHaveBeenCalled();
  });

  it('should sanitize invalid client-provided X-Request-ID', () => {
    const invalidId = '<script>alert(1)</script>';
    const req: any = {
      headers: { 'x-request-id': invalidId },
      socket: { remoteAddress: '127.0.0.1' },
      method: 'GET',
      url: '/api/v1/exams',
    };
    const res: any = {
      setHeader: jest.fn(),
      on: jest.fn(),
    };
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.id).not.toBe(invalidId);
    expect(req.id).toMatch(/^[0-9a-fA-F-]+$/); // Valid generated UUID
    expect(next).toHaveBeenCalled();
  });

  it('should log structured HTTP request upon response finish', () => {
    const spy = jest.spyOn(loggerService, 'logHttp').mockImplementation(() => {});
    let finishCallback: () => void = () => {};

    const req: any = {
      headers: { 'user-agent': 'Mozilla/5.0' },
      socket: { remoteAddress: '127.0.0.1' },
      method: 'GET',
      url: '/api/v1/exams',
      user: { userId: 'usr-888', role: 'STUDENT' },
    };
    const res: any = {
      statusCode: 200,
      setHeader: jest.fn(),
      on: jest.fn().mockImplementation((event, cb) => {
        if (event === 'finish') finishCallback = cb;
      }),
    };
    const next = jest.fn();

    middleware.use(req, res, next);
    finishCallback();

    expect(spy).toHaveBeenCalled();
    const payload = spy.mock.calls[0][0];
    expect(payload.method).toBe('GET');
    expect(payload.path).toBe('/api/v1/exams');
    expect(payload.statusCode).toBe(200);
    expect(payload.userId).toBe('usr-888');
    expect(payload.role).toBe('STUDENT');
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
  });
});
