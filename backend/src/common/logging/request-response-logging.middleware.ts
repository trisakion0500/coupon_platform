import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { maskSensitiveData } from './sensitive-data-masker.util';

/** 로그 한 줄이 너무 길어지는 것을 막는 안전장치(대량 목록 응답 등). */
const MAX_BODY_LOG_LENGTH = 5000;

/** Express Response.json/send는 제네릭 기본값이 `any`라, 여기서 별도 시그니처로 다시 잡아준다. */
type BodyWriter = (body?: unknown) => Response;

function stringifyForLog(value: unknown): string {
  const serialized = JSON.stringify(maskSensitiveData(value));
  if (serialized === undefined) return '(none)';
  return serialized.length > MAX_BODY_LOG_LENGTH
    ? `${serialized.slice(0, MAX_BODY_LOG_LENGTH)}...(truncated)`
    : serialized;
}

/**
 * 모든 HTTP 요청/응답을 REQ/RES로 구분해 상세 기록한다(02_DEV_CONVENTIONS.md 1.1) —
 * 기존에는 500 이상 오류만 `METHOD URL -> STATUS`로 남았고 요청/응답 바디는 전혀 남지 않았다.
 * 민감정보(비밀번호/토큰/API Secret 등)는 `maskSensitiveData`로 마스킹한 뒤 남긴다.
 *
 * `res.json`/`res.send`를 감싸 응답 바디를 가로챈다 — Nest가 인터셉터/예외필터 어느 경로로
 * 응답을 만들든(`ResponseInterceptor`의 성공 응답, `HttpExceptionFilter`의 오류 응답 전부)
 * 최종적으로는 Express의 `res.json`/`res.send`를 거치므로, 이 지점 하나만 감싸면 전 경로를
 * 빠짐없이 포착할 수 있다.
 *
 * @author trisakion
 */
@Injectable()
export class RequestResponseLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID().slice(0, 8);
    const startedAt = Date.now();

    this.logger.log(
      `REQ [${requestId}] ${req.method} ${req.originalUrl} query=${stringifyForLog(req.query)} body=${stringifyForLog(req.body)}`,
    );

    let responseBody: unknown;
    let bodyCaptured = false;

    const captureBody = (body: unknown): void => {
      if (!bodyCaptured) {
        responseBody = body;
        bodyCaptured = true;
      }
    };

    const originalJson = res.json.bind(res) as BodyWriter;
    res.json = ((body?: unknown) => {
      captureBody(body);
      return originalJson(body);
    }) as Response['json'];

    const originalSend = res.send.bind(res) as BodyWriter;
    res.send = ((body?: unknown) => {
      captureBody(body);
      return originalSend(body);
    }) as Response['send'];

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `RES [${requestId}] ${req.method} ${req.originalUrl} status=${res.statusCode} duration=${durationMs}ms body=${stringifyForLog(responseBody)}`,
      );
    });

    next();
  }
}
