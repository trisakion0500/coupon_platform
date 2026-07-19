import { HttpException } from '@nestjs/common';
import { ERROR_MAP } from './error-map';
import { ResultCode } from './result-code.enum';

/**
 * 예측 가능한 비즈니스 실패를 표현하는 예외. result 코드만 넘기면 사용자 메시지와 HTTP status가
 * `ERROR_MAP`(단일 소스)에서 자동으로 채워진다 — 새 오류를 추가할 때 이 클래스는 건드릴 필요 없이
 * `error-map.ts`만 갱신하면 된다.
 *
 * @author trisakion
 */
export class BusinessException extends HttpException {
  /**
   * @param resultCode - 08_API_COMMON.md 8장의 result 코드
   * @param message - 클라이언트에 노출할 메시지(생략 시 `ERROR_MAP`의 기본 메시지 사용)
   */
  constructor(
    public readonly resultCode: ResultCode,
    message?: string,
  ) {
    const entry = ERROR_MAP[resultCode];
    super(
      { result: resultCode, message: message ?? entry.message },
      entry.httpStatus,
    );
  }
}
