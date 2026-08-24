import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ResponseInterceptor } from './../src/common/interceptors/response.interceptor';
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter';
import { RedisService } from './../src/modules/redis/redis.service';
import { TwoFactorProvider } from './../src/modules/auth/otp/two-factor.provider';

describe('Authentication Module & Global Handling (e2e)', () => {
  let app: INestApplication<App>;
  let mockRedisStore: Record<string, string> = {};
  
  const mockRedis = {
    get: jest.fn().mockImplementation((key) => Promise.resolve(mockRedisStore[key] || null)),
    set: jest.fn().mockImplementation((key, val) => {
      mockRedisStore[key] = val;
      return Promise.resolve();
    }),
    del: jest.fn().mockImplementation((key) => {
      delete mockRedisStore[key];
      return Promise.resolve();
    }),
  };

  const mockTwoFactor = {
    sendOtp: jest.fn().mockResolvedValue('mock-session-id-12345'),
    verifyOtp: jest.fn().mockImplementation((sess, code) => {
      if (code === '123456') return Promise.resolve(true);
      return Promise.resolve(false);
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RedisService)
      .useValue(mockRedis)
      .overrideProvider(TwoFactorProvider)
      .useValue(mockTwoFactor)
      .compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (errors) => {
          const formattedErrors = errors.map((err) => ({
            field: err.property,
            messages: Object.values(err.constraints || {}),
          }));
          return new BadRequestException({
            message: 'Validation failed',
            error: 'Bad Request',
            details: formattedErrors,
          });
        },
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();
  });

  beforeEach(() => {
    mockRedisStore = {};
    jest.clearAllMocks();
  });

  it('1. GET / should return formatted success response envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      statusCode: 200,
      message: 'Request successful',
      data: 'Hello World!',
      meta: null,
      timestamp: expect.any(String),
      path: '/',
    });
  });

  it('2. POST /auth/register/student should reject invalid validation schema and format errors', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register/student')
      .send({
        phone: 'invalid-phone',
        name: '',
        state: 'Gujarat',
      })
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      statusCode: 400,
      message: 'Validation failed',
      error: 'Bad Request',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'phone',
          messages: expect.any(Array),
        }),
        expect.objectContaining({
          field: 'name',
          messages: expect.any(Array),
        }),
      ]),
      timestamp: expect.any(String),
      path: '/auth/register/student',
    });
  });

  it('3. GET /non-existent-route should return formatted 404 response', async () => {
    const response = await request(app.getHttpServer())
      .get('/non-existent-route')
      .expect(404);

    expect(response.body).toEqual({
      success: false,
      statusCode: 404,
      message: expect.stringContaining('Cannot GET /non-existent-route'),
      error: 'Not Found',
      details: null,
      timestamp: expect.any(String),
      path: '/non-existent-route',
    });
  });

  it('4. POST /auth/otp/send should normalize mobile, call 2Factor and return success', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/otp/send')
      .send({
        mobileNumber: '9876543210',
      })
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      statusCode: 200,
      message: 'OTP sent successfully',
      data: null,
      meta: null,
      timestamp: expect.any(String),
      path: '/auth/otp/send',
    });

    expect(mockTwoFactor.sendOtp).toHaveBeenCalledWith('+919876543210');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'otp:session:+919876543210',
      JSON.stringify({ sessionId: 'mock-session-id-12345' }),
      300
    );
  });

  it('5. POST /auth/otp/send should prevent resending within cooldown window', async () => {
    mockRedisStore['otp:cooldown:+919876543210'] = '1';

    const response = await request(app.getHttpServer())
      .post('/auth/otp/send')
      .send({
        mobileNumber: '9876543210',
      })
      .expect(400);

    expect(response.body.message).toContain('Please wait 60 seconds');
  });

  it('6. POST /auth/otp/verify should register new user if user does not exist', async () => {
    const randomDigits = Math.floor(100000000 + Math.random() * 900000000).toString();
    const mobile = `9${randomDigits}`;
    const normalized = `+91${mobile}`;

    mockRedisStore[`otp:session:${normalized}`] = JSON.stringify({ sessionId: 'mock-session-id-12345' });

    const response = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({
        mobileNumber: mobile,
        otp: '123456',
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Registration successful');
    expect(response.body.data.user.mobileNumber).toBe(normalized);
    expect(response.body.data.accessToken).toBeDefined();
  });

  it('7. POST /auth/otp/verify should fail with invalid OTP and increment attempts', async () => {
    mockRedisStore['otp:session:+919876543210'] = JSON.stringify({ sessionId: 'mock-session-id-12345' });

    const response = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({
        mobileNumber: '9876543210',
        otp: '000000', // Invalid code
      })
      .expect(400);

    expect(response.body.message).toContain('Invalid OTP');
    expect(mockRedis.set).toHaveBeenCalledWith('otp:attempts:+919876543210', '1', 300);
  });

  afterAll(async () => {
    await app.close();
  });
});
