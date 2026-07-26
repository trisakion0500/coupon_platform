import type { Response } from 'supertest';

/** 08_API_COMMON.md 1.4/1.5의 성공/오류 응답 셰이프 — E2E 스펙 전체가 공유한다. */
export interface SuccessEnvelope<T> {
  result: number;
  data: T;
}
export interface ErrorEnvelope {
  result: number;
  message: string;
}

/** `res.body`는 supertest에서 `any`라 명시적으로 캐스트해 이후 접근을 타입 안전하게 만든다. */
export function success<T>(res: Response): SuccessEnvelope<T> {
  return res.body as SuccessEnvelope<T>;
}
export function failure(res: Response): ErrorEnvelope {
  return res.body as ErrorEnvelope;
}
