# 메인 DB(`coupon_platform`) 테이블 잠금 순서

`trisakion-dev-convention-skill` 4.7절(SP 본문 흐름 — 데드락 방지) 기준 전역 순서표다. 여러 테이블을 잠그거나 갱신하는 SP는 예외 없이 이 순서를 따른다. 새 테이블을 추가하면 이 목록에 위치를 함께 정의하고, 기존 SP의 잠금 순서를 바꾸는 수정을 할 때도 이 표와 충돌하지 않는지 먼저 확인한다.

## 전역 순서

1. `company`
2. `project`
3. `project_api_nonce`
4. `user`
5. `user_role`
6. `user_session`
7. `coupon_campaign`
8. `coupon_code`
9. `coupon_code_usage`

**근거**: `database/tables/all_tables.sql`의 테이블 생성 순서(FK 의존성 순서)와 동일하다 — 자신이 참조하는 테이블 뒤에 위치하는 감각을 그대로 잠금 순서로도 채택했다(`CLAUDE.md` "all_tables.sql의 테이블 순서는... FK 의존성 순서" 원칙 재사용).

## 전체 SP 전수 조사 결과

`database/procedures/*.sql`(로그 적재 없는 순수 SP 62개) 전체를 대상으로 `UPDATE`/`INSERT INTO`/`SELECT ... FOR UPDATE` 문이 실제로 어떤 테이블을 몇 번째로 잠그는지 확인했다. 단순 `SELECT`(FOR UPDATE 아님)는 InnoDB REPEATABLE READ 하에서 잠금을 잡지 않으므로 이 조사에서 제외했다(예: 권한체크용 `FN_*` 호출, `created_by_name` 조회용 `user`/`project` 단순 조회는 잠금 순서와 무관).

| SP | 실제 잠금/쓰기 순서 | 전역 순서 일치 |
| --- | --- | --- |
| `SP_COMPANY_CREATE` | `company` | O |
| `SP_COMPANY_UPDATE` | `company`(FOR UPDATE 캡처 → UPDATE, 동일 테이블) | O |
| `SP_PROJECT_CREATE` | `project` | O |
| `SP_PROJECT_UPDATE` | `project` | O |
| `SP_PROJECT_API_SECRET_ROTATE` | `project` | O |
| `SP_PROJECT_API_SECRET_CLEANUP` | `project` | O |
| `SP_NONCE_INSERT` | `project_api_nonce` | O |
| `SP_NONCE_CLEANUP` | `project_api_nonce`(DELETE, 단일 테이블) | O |
| `SP_USER_SIGNUP` | `user` | O |
| `SP_USER_APPROVE` | `user`(FOR UPDATE 캡처 → UPDATE) | O |
| `SP_USER_REJECT` | `user`(FOR UPDATE 캡처 → UPDATE) | O |
| `SP_USER_UPDATE` | `user` → `user_session`(status=3 전환 시 로그아웃 처리) | O |
| `SP_USER_PASSWORD_CHANGE` | `user` → `user_session` | O |
| `SP_USER_PASSWORD_RESET` | `user` → `user_session` | O |
| `SP_USER_ROLE_CREATE` | `user_role` | O |
| `SP_USER_ROLE_UPDATE` | `user_role`(FOR UPDATE 캡처 → UPDATE) | O |
| `SP_USER_SESSION_CREATE` | `user` → `user_session` | O |
| `SP_SESSION_CLEANUP` | `user_session`(DELETE, 단일 테이블) | O |
| `SP_CAMPAIGN_CREATE` | `coupon_campaign` | O |
| `SP_CAMPAIGN_UPDATE` | `coupon_campaign` | O |
| `SP_CAMPAIGN_CHANGE_STATUS` | `coupon_campaign` | O |
| `SP_CAMPAIGN_APPROVE` | `coupon_campaign` | O |
| `SP_CAMPAIGN_REJECT` | `coupon_campaign` | O |
| `SP_CAMPAIGN_EXPIRE` | `coupon_campaign`(임시테이블 `tmp_expiring_campaigns`은 세션 로컬이라 전역순서 대상 아님) | O |
| `SP_CAMPAIGN_CODE_ISSUE` | `coupon_campaign`(선점 UPDATE) → `coupon_code`(INSERT, 신규 행) → `coupon_campaign`(완료 UPDATE) | O |
| `SP_CAMPAIGN_CODE_GENERATE_ONE` | `coupon_campaign`(슬롯예약 UPDATE) → `coupon_code`(INSERT, 신규 행) | O |
| `SP_CAMPAIGN_CODE_GENERATION_COMPLETE` | `coupon_campaign` | O |
| `SP_CAMPAIGN_CODE_GENERATION_FAIL` | `coupon_campaign` | O |
| `SP_CAMPAIGN_CODE_ABORT` | `coupon_campaign` | O |
| `SP_CAMPAIGN_CODE_RETRY` | `coupon_campaign` | O |
| `SP_COUPON_RESERVE` | `coupon_code`(기존 행 UPDATE) → `coupon_campaign`(UPDATE) → `coupon_code_usage`(INSERT → FOR UPDATE 재확인) | **예외** — 아래 참고 |
| `SP_COUPON_CONFIRM` | `coupon_code_usage` | O |

그 외 조회 전용 SP(`SP_*_LIST`, `SP_*_GET_BY_*`, `SP_PROJECT_CHECK_ACCESS`, `SP_USER_SESSION_VALIDATE_BY_JTI`, `SP_USER_SESSION_LOGOUT`, `SP_USER_SESSION_UPDATE_JTI`, `SP_CAMPAIGN_CODE_GENERATION_STALE_LIST`, `SP_LOCK_ACQUIRE`/`RELEASE` 등)는 단일 테이블만 쓰거나 잠금을 잡는 문(UPDATE/INSERT/FOR UPDATE)이 없어 전역순서 대상이 아니다.

## 예외 — `SP_COUPON_RESERVE`의 `coupon_code` → `coupon_campaign` 순서

전역 순서(`coupon_campaign` → `coupon_code`)와 반대로, `SP_COUPON_RESERVE`만 **코드락 → 캠페인락 → 사용자한도 갭락** 순서를 의도적으로 고정한다(`CLAUDE.md` 2026-07-22 "쿠폰 도메인 4단계" 및 동시성 감사 항목 참고).

- **왜 반대 순서가 안전한가**: `coupon_code`에 대한 다른 모든 쓰기(`SP_CAMPAIGN_CODE_ISSUE`/`SP_CAMPAIGN_CODE_GENERATE_ONE`)는 전부 **신규 행 INSERT**만 수행하고 기존 행을 잠그지 않는다. 반면 `SP_COUPON_RESERVE`는 **이미 존재하는 특정 `coupon_code_id` 행**을 조건부 UPDATE(RANDOM)하거나 상태만 확인(FIXED, 잠금 없음)한 뒤 `coupon_campaign` 행을 잠근다. 즉 이 예외 경로가 실제로 잠그는 대상(기존 코드 행)과 코드생성 경로가 잠그는 대상(신규 코드 행)이 서로 겹치지 않아, 두 방향의 대기가 순환(cycle)을 이루는 진짜 데드락 조건이 성립하지 않는다.
- **왜 이 순서여야만 하는가**: 반대로 전역순서(캠페인 먼저)를 그대로 적용하면, 같은 FIXED 코드에 대해 동시에 들어오는 두 reserve 요청이 아직 행이 없는 같은 `coupon_code_usage` 갭에서 충돌해 데드락(1213)이 실제로 재현된 이력이 있다(`CLAUDE.md` 2026-07-22 "전체 SP/서비스 동시성 전수 감사 2회차" 항목).
- 이 SP를 수정할 때는 이 순서(코드 → 캠페인 → 사용이력)를 유지해야 하며, 만약 `coupon_code`에 대한 기존 행 UPDATE를 수행하는 SP가 새로 추가된다면 이 예외가 여전히 안전한지(그 SP가 캠페인 락도 함께 잡는지) 반드시 재검토한다.

## 로그 DB와의 관계

메인 DB(`database/`)와 로그 DB(`database_log/`)는 물리적으로 분리된 별도 DB라 같은 트랜잭션으로 묶이지 않는다(`trisakion-dev-convention-skill` 7장). 따라서 이 순서표는 로그 DB 테이블(`log_audit`/`log_coupon_campaign`/`log_coupon_rate_limit`/`log_coupon_use`)과는 완전히 독립적이며, 로그 DB 자체의 순서표는 `database_log/TABLE_LOCK_ORDER.md`를 따로 둔다.
