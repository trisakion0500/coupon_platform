import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequestResponseLoggingMiddleware } from './request-response-logging.middleware';

/** `Logger.prototype.log`은 파라미터가 `any`라, 여기서 안전하게 문자열만 뽑아온다. */
function loggedMessage(spy: jest.SpyInstance, callIndex: number): string {
  const calls = spy.mock.calls as unknown[][];
  return calls[callIndex][0] as string;
}

function buildResponse(): {
  response: Response;
  emitFinish: () => void;
  jsonSpy: jest.Mock;
} {
  let finishHandler: (() => void) | undefined;
  const jsonSpy = jest.fn();

  const response = {
    statusCode: 200,
    json: jsonSpy,
    send: jest.fn(),
    on: (event: string, handler: () => void) => {
      if (event === 'finish') finishHandler = handler;
    },
  } as unknown as Response;

  return {
    response,
    jsonSpy,
    emitFinish: () => finishHandler?.(),
  };
}

describe('RequestResponseLoggingMiddleware', () => {
  let middleware: RequestResponseLoggingMiddleware;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    middleware = new RequestResponseLoggingMiddleware();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs the incoming request with masked body before calling next()', () => {
    const req = {
      method: 'POST',
      originalUrl: '/v1/auth/login',
      query: {},
      body: { login_id: 'sa', password: 'super-secret' },
    } as unknown as Request;
    const { response } = buildResponse();
    const next = jest.fn();

    middleware.use(req, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const requestLog = loggedMessage(logSpy, 0);
    expect(requestLog).toContain('REQ ');
    expect(requestLog).toContain('POST /v1/auth/login');
    expect(requestLog).toContain('"login_id":"sa"');
    expect(requestLog).not.toContain('super-secret');
    expect(requestLog).toContain('"password":"***"');
  });

  it('logs the outgoing response with masked body and status on finish', () => {
    const req = {
      method: 'POST',
      originalUrl: '/v1/auth/login',
      query: {},
      body: {},
    } as unknown as Request;
    const { response, jsonSpy, emitFinish } = buildResponse();
    response.statusCode = 200;
    const next = jest.fn();

    middleware.use(req, response, next);
    response.json({
      result: 0,
      data: { access_token: 'jwt-token', refresh_token: 'rt' },
    });
    emitFinish();

    expect(jsonSpy).toHaveBeenCalled();
    const responseLog = loggedMessage(logSpy, 1);
    expect(responseLog).toContain('RES ');
    expect(responseLog).toContain('status=200');
    expect(responseLog).toContain('"access_token":"***"');
    expect(responseLog).toContain('"refresh_token":"***"');
    expect(responseLog).not.toContain('jwt-token');
  });

  it('captures only the first body write if json/send is called more than once', () => {
    const req = {
      method: 'GET',
      originalUrl: '/health',
      query: {},
      body: {},
    } as unknown as Request;
    const { response, emitFinish } = buildResponse();
    const next = jest.fn();

    middleware.use(req, response, next);
    response.json({ result: 0, data: { status: 'ok' } });
    response.json({ result: 0, data: { status: 'overwritten' } });
    emitFinish();

    const responseLog = loggedMessage(logSpy, 1);
    expect(responseLog).toContain('"status":"ok"');
    expect(responseLog).not.toContain('overwritten');
  });
});
