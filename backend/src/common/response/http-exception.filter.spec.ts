import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from './business.exception';
import { ERROR_MAP } from './error-map';
import { HttpExceptionFilter } from './http-exception.filter';
import { ResultCode } from './result-code.enum';

function buildHost(): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const request = { method: 'GET', url: '/x' };
  const response = { status };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  const configService = {
    get: jest.fn(() => false),
  } as unknown as ConfigService;
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter(configService);
  });

  it('passes BusinessException through with its own mapped status', () => {
    const { host, status, json } = buildHost();
    filter.catch(new BusinessException(ResultCode.PROJECT_NOT_FOUND), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      result: ResultCode.PROJECT_NOT_FOUND,
      message: ERROR_MAP[ResultCode.PROJECT_NOT_FOUND].message,
    });
  });

  it('maps ValidationPipe BadRequestException to 30002/400', () => {
    const { host, status, json } = buildHost();
    filter.catch(new BadRequestException(['field must not be empty']), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      result: ResultCode.INVALID_FIELD_FORMAT,
      message: 'field must not be empty',
    });
  });

  it('maps UnauthorizedException to 10004/401', () => {
    const { host, status, json } = buildHost();
    filter.catch(new UnauthorizedException(), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      result: ResultCode.LOGIN_REQUIRED,
      message: 'Unauthorized',
    });
  });

  it('maps ForbiddenException to 20001/403', () => {
    const { host, status, json } = buildHost();
    filter.catch(new ForbiddenException(), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      result: ResultCode.PERMISSION_DENIED,
      message: 'Forbidden',
    });
  });

  it('collapses unknown errors to 50000/500', () => {
    const { host, status, json } = buildHost();
    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      result: ResultCode.INTERNAL_ERROR,
      message: 'Internal server error',
    });
  });
});
