import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mysql, { Pool } from 'mysql2/promise';
import { callStoredProcedure, SpCallResult } from './sp-result.util';

export type { SpCallResult };

/**
 * 메인 서비스 DB(coupon_platform) 접근 서비스. mysql2 + Stored Procedure 전용 데이터 접근
 * 정책(01_TECH_STACK.md)에 따라 모든 SP 호출은 이 서비스를 거친다. ORM/Native SQL 직접 작성 금지.
 * 로그 전용 DB(coupon_platform_log)는 이 서비스와 완전히 분리된 `LogSpExecutorService`를 쓴다
 * (02_DEV_CONVENTIONS.md 1장).
 *
 * @author trisakion
 */
@Injectable()
export class SpExecutorService implements OnModuleDestroy {
  private readonly logger = new Logger(SpExecutorService.name);
  private readonly pool: Pool;

  /** 환경변수(DB_HOST 등)로 mysql2 커넥션 풀을 생성한다. */
  constructor(configService: ConfigService) {
    this.pool = mysql.createPool({
      host: configService.get<string>('DB_HOST'),
      port: configService.get<number>('DB_PORT'),
      user: configService.get<string>('DB_USER'),
      password: configService.get<string>('DB_PASSWORD'),
      database: configService.get<string>('DB_NAME'),
      waitForConnections: true,
      connectionLimit: 10,
      // 08_API_COMMON.md 4장: 날짜/시간은 문자열로 전송 — Date 객체 변환/타임존 이슈를 피하기 위해
      // DATETIME 컬럼을 애초에 문자열로 받는다.
      dateStrings: true,
    });
  }

  /** 앱 종료 시 커넥션 풀을 정리한다(NestJS 라이프사이클 훅). */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * SP를 호출하고 RESULT SELECT 규약(02_DEV_CONVENTIONS.md 3.4)을 파싱해 반환한다.
   *
   * @param spName - 호출할 Stored Procedure 이름(`USP_도메인_동작`)
   * @param params - `CALL`의 IN 파라미터 목록(선언 순서대로)
   */
  async callProcedure<TData = unknown>(
    spName: string,
    params: unknown[] = [],
  ): Promise<SpCallResult<TData>> {
    return callStoredProcedure<TData>(this.pool, this.logger, spName, params);
  }
}
