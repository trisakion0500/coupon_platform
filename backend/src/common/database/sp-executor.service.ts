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
      // 레플리카당 pool 크기 — 하드코딩이었다가 스케일아웃 점검(2026-07-23)에서 env로 이전,
      // 레플리카 수를 늘릴 때 MySQL max_connections 한도에 맞춰 조정 가능해야 하므로.
      connectionLimit: configService.get<number>('DB_CONNECTION_LIMIT'),
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
   * @param spName - 호출할 Stored Procedure 이름(`SP_도메인_동작`)
   * @param params - `CALL`의 IN 파라미터 목록(선언 순서대로)
   */
  async callProcedure<TData = unknown>(
    spName: string,
    params: unknown[] = [],
  ): Promise<SpCallResult<TData>> {
    return callStoredProcedure<TData>(this.pool, this.logger, spName, params);
  }

  /**
   * MySQL 세션 수준 advisory lock(`GET_LOCK`/`RELEASE_LOCK`)으로 여러 인스턴스(레플리카)가
   * 동시에 같은 크론 배치를 중복 실행하지 않도록 한다(스케일아웃 점검 3번, 2026-07-23) — 이미
   * 쓰고 있는 MySQL만으로 해결해 Redis 등 별도 분산 락 인프라를 새로 들이지 않는다.
   * `GET_LOCK`은 락을 커넥션 세션에 묶어 관리하므로(그 커넥션이 끝날 때까지 유지) pool에서
   * 커넥션 하나를 직접 뽑아 잡고 있어야 한다 — `callProcedure`처럼 매 호출마다 pool이 임의로
   * 골라주는 커넥션을 쓰면 락을 건 커넥션과 푸는 커넥션이 달라질 수 있어 안 된다.
   * timeout=0(non-blocking)으로 시도해 이미 다른 인스턴스가 실행 중이면 대기하지 않고 즉시
   * 포기한다 — 크론은 다음 스케줄에 또 돌아오므로 여기서 기다릴 이유가 없다.
   *
   * @param lockName - 배치를 식별하는 락 이름(인스턴스 간 공유되는 문자열 키)
   * @param fn - 락을 획득했을 때만 실행할 작업
   * @returns 락을 획득해 `fn`을 실행했으면 true, 다른 인스턴스가 이미 실행 중이라 건너뛰었으면 false
   */
  async runExclusive(
    lockName: string,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS acquired', [
        lockName,
      ]);
      const acquired =
        (rows as unknown as Array<{ acquired: number }>)[0]?.acquired === 1;
      if (!acquired) {
        return false;
      }

      try {
        await fn();
      } finally {
        await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
      }
      return true;
    } finally {
      conn.release();
    }
  }
}
