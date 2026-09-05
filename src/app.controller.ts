import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('helth')
  @HttpCode(HttpStatus.OK)
  getHelth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  getHealthz() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ping')
  @HttpCode(HttpStatus.OK)
  getPing() {
    return { pong: true, timestamp: new Date().toISOString() };
  }
}
