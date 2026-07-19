import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mysql, { Pool } from 'mysql2/promise';
import { callStoredProcedure, SpCallResult } from './sp-result.util';

/**
 * 로그 전용 DB(coupon_platform_log) 접근 서비스. 메인 DB(`SpExecutorService`)와 물리적으로
 * 분리된 별도 커넥션 풀을 쓴다(02_DEV_CONVENTIONS.md 1장) — 로그 적재가 메인 트랜잭션과 같은
 * 커넥션/트랜잭션에 절대 묶이지 않는다는 원칙을 구조적으로 강제하기 위함이다.
 *
 * @author trisakion
 */
@Injectable()
export class LogSpExecutorService implements OnModuleDestroy {
  private readonly logger = new Logger(LogSpExecutorService.name);
  private readonly pool: Pool;

  /** 환경변수(LOG_DB_HOST 등)로 로그 DB 전용 mysql2 커넥션 풀을 생성한다. */
  constructor(configService: ConfigService) {
    this.pool = mysql.createPool({
      host: configService.get<string>('LOG_DB_HOST'),
      port: configService.get<number>('LOG_DB_PORT'),
      user: configService.get<string>('LOG_DB_USER'),
      password: configService.get<string>('LOG_DB_PASSWORD'),
      database: configService.get<string>('LOG_DB_NAME'),
      waitForConnections: true,
      connectionLimit: 10,
      dateStrings: true,
    });
  }

  /** 앱 종료 시 커넥션 풀을 정리한다(NestJS 라이프사이클 훅). */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * 로그 SP를 호출하고 RESULT SELECT 규약을 파싱해 반환한다. 로그 **조회**(예: 13_LOG_AUDIT_API.md의
   * 감사 로그 목록 API)처럼 실패를 호출자가 그대로 알아야 하는 경우에 쓴다 — 조회 실패는 메인
   * 트랜잭션과 무관하므로 굳이 삼켜야 할 이유가 없다. 로그 **기록**에는 {@link logCall}을 쓴다.
   */
  async callProcedure<TData = unknown>(
    spName: string,
    params: unknown[] = [],
  ): Promise<SpCallResult<TData>> {
    return callStoredProcedure<TData>(this.pool, this.logger, spName, params);
  }

  /**
   * 로그 적재 SP를 호출하되 실패해도 절대 throw하지 않는다(02_DEV_CONVENTIONS.md 1장: 로그 적재
   * 실패가 메인 트랜잭션에 영향을 주면 안 된다). 호출자는 반환값을 기다리지 않고 fire-and-forget으로
   * 호출해도 안전하다 — 실패는 서버 로그로만 남는다. SP 시스템 오류(50001)는
   * `callProcedure`(→ `callStoredProcedure`)가 이미 예외로 던지므로 여기서는 그 예외만 잡으면 된다.
   */
  async logCall(spName: string, params: unknown[] = []): Promise<void> {
    try {
      await this.callProcedure(spName, params);
    } catch (err) {
      this.logger.error(
        `${spName} threw while writing log — main flow unaffected: ${(err as Error).message}`,
      );
    }
  }
}
