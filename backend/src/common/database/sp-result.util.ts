import { Logger } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { BusinessException } from '../response/business.exception';
import { ResultCode } from '../response/result-code.enum';

/**
 * SP 호출 결과(02_DEV_CONVENTIONS.md 3.4 RESULT SELECT 규약)를 파싱한 값.
 * RESULT=50001(시스템 오류)은 여기 담기지 않는다 — {@link callStoredProcedure}가 그 경우
 * 즉시 예외를 던지므로, 이 타입의 `result`는 항상 0이거나 SP가 정의한 특정 비즈니스 코드다.
 *
 * @property result - 첫 번째 result set의 RESULT 컬럼 값(성공은 0)
 * @property data - RESULT=0일 때만 존재하는 두 번째 result set(SP마다 스키마가 다름)
 *
 * @author trisakion
 */
export interface SpCallResult<TData = unknown> {
  result: number;
  data?: TData;
}

/**
 * SP를 호출하고 RESULT SELECT 규약을 파싱한다. 메인 DB(`SpExecutorService`)와 로그 DB
 * (`LogSpExecutorService`)가 커넥션 풀만 다를 뿐 이 로직을 그대로 공유한다(02_DEV_CONVENTIONS.md
 * 2장 "두 번 이상 중복되는 코드는 모듈화한다").
 *
 * - 첫 result set은 항상 RESULT 단일 컬럼 단일 행
 * - RESULT=0일 때만 두 번째 result set(data)이 존재
 * - RESULT=50001(시스템 오류)은 SQL_STATE/ERROR_NO/ERROR_MESSAGE를 서버 로그로 남기고
 *   `BusinessException(DATABASE_ERROR)`을 즉시 던진다 — 호출부마다 "혹시 50001 아닌가"를
 *   따로 확인할 필요 없이, 여기서 한 번 막아두면 그 아래 어떤 비즈니스 로직도 시스템 오류를
 *   특정 비즈니스 실패로 착각해 잘못 분류할 수 없다(2026-07-19 리뷰에서 흩어진 50001 체크가
 *   누락된 호출부를 여러 곳 발견한 뒤, 참고 구현체의 `callSP` 패턴을 그대로 적용). SQL_STATE/
 *   ERROR_NO는 던지는 예외의 `sqlDiagnostics`에도 실어 보낸다(HTTP 응답 바디에는 안 실림) —
 *   `CampaignCodeService.generateRandomCodes`처럼 재시도 가능한 에러(deadlock/lock wait timeout)와
 *   그렇지 않은 에러를 구분해야 하는 극히 드문 내부 호출부를 위한 것으로, 대부분의 호출부는 이
 *   필드를 알 필요도 없고 봐서도 안 된다(05_COUPON_ISSUANCE_SCENARIO.md 2.2, 2026-07-21 추가).
 *
 * @param pool - 호출에 사용할 mysql2 커넥션 풀(메인/로그 DB 중 하나)
 * @param logger - 50001 진단 정보를 남길 로거
 * @param spName - 호출할 Stored Procedure 이름(`SP_도메인_동작`)
 * @param params - `CALL`의 IN 파라미터 목록(선언 순서대로)
 * @returns 파싱된 RESULT/data(RESULT는 0 또는 SP가 정의한 특정 비즈니스 코드)
 * @throws {Error} 첫 result set에 RESULT 컬럼이 없는 경우(SP가 규약을 위반한 버그 상황)
 * @throws {BusinessException} 50001 — SP 내부 시스템 오류(DB 제약 위반, 데드락 등)
 */
export async function callStoredProcedure<TData = unknown>(
  pool: Pool,
  logger: Logger,
  spName: string,
  params: unknown[] = [],
): Promise<SpCallResult<TData>> {
  const placeholders = params.map(() => '?').join(', ');
  const sql = `CALL ${spName}(${placeholders})`;

  const [resultSets] = await pool.query(sql, params);
  const sets = resultSets as unknown as Array<Array<Record<string, unknown>>>;

  const firstRow = sets[0]?.[0];
  if (!firstRow || typeof firstRow.RESULT !== 'number') {
    throw new Error(
      `${spName}: RESULT SELECT convention violated — no RESULT column in first result set`,
    );
  }

  const result = firstRow.RESULT;

  if (result === 50001) {
    const sqlState = String(firstRow.SQL_STATE);
    const errorNo = Number(firstRow.ERROR_NO);
    logger.error(
      `${spName} DB error — SQL_STATE=${sqlState} ` +
        `ERROR_NO=${errorNo} MESSAGE=${String(firstRow.ERROR_MESSAGE)}`,
    );
    // sqlState/errorNo는 HTTP 응답 바디에는 실리지 않는다(BusinessException 생성자 참고) —
    // CampaignCodeService의 RANDOM 코드 생성 재시도 루프처럼 재시도 가능 여부를 직접 판단해야 하는
    // 극히 드문 내부 호출부만을 위한 것이다.
    throw new BusinessException(ResultCode.DATABASE_ERROR, undefined, {
      sqlState,
      errorNo,
    });
  }

  if (result !== 0) {
    return { result };
  }

  const dataRows = sets[1];
  return { result, data: dataRows as unknown as TData };
}
