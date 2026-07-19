import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { BusinessException } from './business.exception';
import { ResultCode } from './result-code.enum';

/** {@link HttpExceptionFilter}가 모든 예외를 변환한 최종 형태. */
interface NormalizedError {
  status: number;
  body: { result: number; message: string };
}

/**
 * 08_API_COMMON.md 1.5: 비즈니스 오류를 HTTP 200으로 반환하지 않는다.
 * 모든 예외를 {result, message} 형태로 정규화하는 전역 필터.
 *
 * @author trisakion
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly configService: ConfigService) {}

  /**
   * NestJS가 잡은 모든 예외의 진입점. 정규화한 뒤 응답을 직접 작성하고,
   * 500 이상인 경우 서버 로그를 남긴다(스택은 LOG_DEBUG_ERRORS일 때만).
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.normalize(exception);

    if (status >= 500) {
      const debugErrors = this.configService.get<boolean>('LOG_DEBUG_ERRORS');
      this.logger.error(
        `${request.method} ${request.url} -> ${status} result=${body.result}`,
        debugErrors && exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json(body);
  }

  /** 예외 타입별로 {status, body}를 결정한다. */
  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof BusinessException) {
      const body = exception.getResponse() as {
        result: number;
        message: string;
      };
      return { status: exception.getStatus(), body };
    }

    if (exception instanceof HttpException) {
      return this.normalizeHttpException(exception);
    }

    return {
      status: 500,
      body: {
        result: ResultCode.INTERNAL_ERROR,
        message: 'Internal server error',
      },
    };
  }

  /**
   * BusinessException이 아닌 NestJS 기본 예외(ValidationPipe의 BadRequestException,
   * 라우트 없음 NotFoundException 등)를 위한 기본 매핑. 08_API_COMMON.md에 대응되는
   * result 코드가 없는 경우(예: 잘못된 라우트 404)는 System 오류로 수렴시킨다 —
   * 정상적인 클라이언트 흐름에서는 발생하지 않는 경로라 별도 코드를 두지 않았다.
   */
  private normalizeHttpException(exception: HttpException): NormalizedError {
    const status = exception.getStatus();
    const message = this.extractMessage(exception);

    switch (status) {
      case 400:
        return {
          status,
          body: { result: ResultCode.INVALID_FIELD_FORMAT, message },
        };
      case 401:
        return { status, body: { result: ResultCode.LOGIN_REQUIRED, message } };
      case 403:
        return {
          status,
          body: { result: ResultCode.PERMISSION_DENIED, message },
        };
      case 429:
        return {
          status,
          body: { result: ResultCode.RATE_LIMIT_EXCEEDED, message },
        };
      default:
        return {
          status: 500,
          body: {
            result: ResultCode.INTERNAL_ERROR,
            message: 'Internal server error',
          },
        };
    }
  }

  /** HttpException 응답 바디에서 사람이 읽을 메시지를 뽑아낸다(배열이면 쉼표로 합침). */
  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;

    const message = (response as { message?: string | string[] }).message;
    if (Array.isArray(message)) return message.join(', ');
    return message ?? exception.message;
  }
}
