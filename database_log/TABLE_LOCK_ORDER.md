# 로그 DB(`coupon_platform_log`) 테이블 잠금 순서

`trisakion-dev-convention-skill` 4.7절(SP 본문 흐름 — 데드락 방지) 기준 전역 순서표다. 메인 DB(`database/TABLE_LOCK_ORDER.md`)와는 물리적으로 분리된 별도 DB라 독립된 순서표를 둔다(같은 트랜잭션으로 절대 묶이지 않으므로 DB 경계를 넘는 순서까지 정할 필요는 없다 — 7장 로깅 원칙).

## 전역 순서

1. `log_audit`
2. `log_coupon_campaign`
3. `log_coupon_rate_limit`
4. `log_coupon_use`

**근거**: `database_log/tables/all_log_tables.sql`의 테이블 생성 순서(신설된 시점 순)와 동일하다. 이 4개 테이블은 서로 FK로 얽혀있지 않은 독립된 append-only 로그 테이블이라(6장 참고) 실질적인 잠금 경합 위험은 없지만, 새 로그 테이블이 추가될 때 위치를 일관되게 정의해두기 위한 기준선으로 유지한다.

## 전체 SP 전수 조사 결과

`database_log/procedures/*.sql`(로그 적재 SP 4개: `SP_LOG_AUDIT_CREATE`, `SP_LOG_COUPON_CAMPAIGN_CREATE`, `SP_LOG_COUPON_RATE_LIMIT_CREATE`, `SP_LOG_COUPON_USE_CREATE`) 전체를 확인한 결과, **각 SP는 예외 없이 정확히 하나의 테이블에만 `INSERT`를 수행한다** — `UPDATE`/`DELETE`/`SELECT ... FOR UPDATE`를 쓰는 SP는 하나도 없다(4.4절 예외: 반환값을 쓰지 않는 순수 로그 적재 SP라 RESULT SELECT 하나만 반환하고 두 번째 SELECT도 없음).

| SP | 쓰기 대상 테이블 | 비고 |
| --- | --- | --- |
| `SP_LOG_AUDIT_CREATE` | `log_audit` | 단일 테이블 INSERT |
| `SP_LOG_COUPON_CAMPAIGN_CREATE` | `log_coupon_campaign` | 단일 테이블 INSERT |
| `SP_LOG_COUPON_RATE_LIMIT_CREATE` | `log_coupon_rate_limit` | 단일 테이블 INSERT |
| `SP_LOG_COUPON_USE_CREATE` | `log_coupon_use` | 단일 테이블 INSERT |

조회 전용 SP(`SP_LOG_AUDIT_LIST`/`GET_BY_ID`, `SP_LOG_COUPON_CAMPAIGN_LIST`, `SP_LOG_COUPON_RATE_LIMIT_LIST`, `SP_LOG_COUPON_USE_LIST`)도 전부 단일 테이블 `SELECT`(FOR UPDATE 아님)만 수행해 잠금 순서 대상이 아니다.

## 예외

현재 없음 — 여러 로그 테이블에 걸쳐 쓰기를 수행하는 SP가 없어 순서 충돌 자체가 발생할 수 없는 구조다. 앞으로 한 SP가 두 개 이상의 로그 테이블에 INSERT하게 되는 경우(예: 하나의 이벤트를 여러 로그 테이블에 동시에 남기는 신규 요구사항)가 생기면, 그때 위 전역 순서를 따르고 이 절에 실제 사례를 추가한다.
