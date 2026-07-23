import { HttpException } from '@nestjs/common';
import { ERROR_MAP } from './error-map';
import { ResultCode } from './result-code.enum';

/** RESULT=50001(DATABASE_ERROR)에서만 채워지는 SP 진단 정보 — `sp-result.util.ts` 참고. */
export interface SqlDiagnostics {
  sqlState: string;
  errorNo: number;
}

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
   * @param sqlDiagnostics - RESULT=50001일 때만 `sp-result.util.ts`가 채워 넣는 SQL_STATE/ERROR_NO.
   *   `super()`에 전달하는 HTTP 응답 바디에는 포함하지 않으므로 클라이언트에는 절대 노출되지
   *   않는다 — `CampaignCodeService.generateRandomCodes`처럼 재시도 가능 여부를 판단해야 하는 극히
   *   드문 내부 호출부만 이 예외 인스턴스에서 직접 읽어 쓴다(02_DEV_CONVENTIONS.md 7장 참고).
   */
  constructor(
    public readonly resultCode: ResultCode,
    message?: string,
    public readonly sqlDiagnostics?: SqlDiagnostics,
  ) {
    const entry = ERROR_MAP[resultCode];
    super(
      { result: resultCode, message: message ?? entry.message },
      entry.httpStatus,
    );
  }
}
