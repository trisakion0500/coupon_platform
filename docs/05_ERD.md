# 05_ERD.md

## Coupon Platform Entity Relationship Diagram

---

```mermaid
erDiagram

    company {
        BIGINT      company_id      PK
        VARCHAR20   company_code    UK
        VARCHAR100  company_name
        VARCHAR1000 description     "NULL허용"
        TINYINT     status
        DATETIME    created_at
        DATETIME    updated_at
    }

    project {
        BIGINT      project_id              PK
        BIGINT      company_id              FK
        VARCHAR20   project_code            "UK(company_id 범위내)"
        VARCHAR100  project_name
        VARCHAR1000 description             "NULL허용"
        VARCHAR64   api_key                 UK "게임서버→쿠폰서버 S2S 인증"
        VARCHAR255  api_secret              "AES-256-CBC 암호화(Base64), HMAC 서명검증용"
        VARCHAR255  api_secret_prev         "NULL허용, 재발급 유예기간 동안만 유지"
        DATETIME    secret_rotated_at       "NULL허용"
        TINYINT     status
        DATETIME    created_at
        DATETIME    updated_at
        INT         edit_count              "낙관적 동시성 제어"
    }

    user {
        BIGINT      user_id                 PK
        BIGINT      company_id              FK
        BIGINT      requested_project_id    FK "NULL허용"
        VARCHAR100  login_id                UK
        VARCHAR255  password_hash
        VARCHAR100  user_name
        VARCHAR200  email                   UK
        VARCHAR255  phone_number            "AES-256-CBC 암호화(Base64)"
        VARCHAR100  department              "NULL허용"
        VARCHAR100  position                "NULL허용"
        TINYINT     status
        DATETIME    last_login_at           "NULL허용"
        DATETIME    created_at
        DATETIME    updated_at
    }

    user_role {
        BIGINT   user_id     PK "FK→user"
        BIGINT   project_id  PK "FK→project"
        TINYINT  role_code
        TINYINT  status
        DATETIME created_at
        DATETIME updated_at
    }

    user_session {
        BIGINT      session_id          PK
        BIGINT      user_id             "FK없음(의도)"
        VARCHAR100  access_token_jti    UK
        VARCHAR255  refresh_token_hash
        DATETIME    expired_at
        DATETIME    last_access_at      "NULL허용"
        TINYINT     status
        DATETIME    created_at
        DATETIME    updated_at
    }

    coupon_campaign {
        BIGINT      coupon_campaign_id  PK
        BIGINT      project_id          FK
        VARCHAR100  name
        DATETIME    campaign_start
        DATETIME    campaign_end
        TINYINT     code_type           "1:RANDOM, 2:FIXED"
        TINYINT     use_hyphen          "RANDOM에만 적용"
        INT         requested_qty
        INT         generated_qty
        TINYINT     generation_status   "1:대기,2:진행중,3:완료,4:실패 - status/approval_status와 별개 축"
        VARCHAR500  generation_error    "NULL허용, 재시도 소진 시 최종 실패 사유"
        INT         usable_qty
        INT         used_qty
        INT         use_limit_per_user
        TINYINT     status              "1:대기,2:활성,3:일시중지,4:종료"
        TINYINT     approval_status     "status와 별개 축"
        BIGINT      approved_by         FK "NULL허용"
        DATETIME    approved_at         "NULL허용"
        VARCHAR500  reject_reason       "NULL허용"
        JSON        reward_data
        BIGINT      created_by          FK "NULL허용"
        BIGINT      updated_by          FK "NULL허용"
        DATETIME    created_at
        DATETIME    updated_at
        INT         edit_count          "낙관적 동시성 제어"
    }

    coupon_code {
        BIGINT      coupon_code_id      PK
        BIGINT      coupon_campaign_id  FK
        BIGINT      project_id          FK "비정규화, UK(project_id+code_value)"
        VARCHAR50   code_value          "UK(project_id 범위내)"
        TINYINT     status              "0:중지,1:미사용/사용중,2:사용완료(RANDOM)"
        DATETIME    created_at
        DATETIME    updated_at
    }

    coupon_code_usage {
        BIGINT      coupon_code_usage_id    PK
        BIGINT      coupon_code_id          FK
        BIGINT      coupon_campaign_id      FK "비정규화"
        BIGINT      project_id              FK "비정규화"
        VARCHAR100  game_user_id            "FK없음, 게임서버 자체 식별자"
        DATETIME    confirmed_at            "NULL허용, NULL=미컨슘"
        DATETIME    created_at
        DATETIME    updated_at
    }

    log_audit {
        BIGINT      idx             PK
        TINYINT     action
        BIGINT      company_id      "스코핑용(FK없음), NULL허용"
        BIGINT      project_id      "스코핑용(FK없음), NULL허용"
        VARCHAR100  table_name
        VARCHAR100  target_id
        VARCHAR200  target_name     "NULL허용"
        LONGTEXT    before_json     "NULL허용"
        LONGTEXT    after_json
        BIGINT      created_by      "FK없음(로그원칙)"
        VARCHAR50   created_by_name "작업자명 스냅샷, NULL허용"
        DATETIME    created_at
    }

    log_coupon_campaign {
        BIGINT      idx                 PK
        TINYINT     action              "10:CREATE,20:UPDATE,30:STATUS_CHANGE,40:APPROVE,50:REJECT"
        BIGINT      coupon_campaign_id  "FK없음(로그원칙), 원본 참조"
        BIGINT      project_id          "FK없음(로그원칙), 스냅샷"
        VARCHAR100  name                "스냅샷"
        DATETIME    campaign_start      "스냅샷"
        DATETIME    campaign_end        "스냅샷"
        TINYINT     code_type           "스냅샷"
        TINYINT     use_hyphen          "스냅샷"
        INT         requested_qty       "스냅샷"
        INT         generated_qty       "스냅샷"
        INT         usable_qty          "스냅샷"
        INT         used_qty            "스냅샷"
        INT         use_limit_per_user  "스냅샷"
        TINYINT     status              "스냅샷"
        TINYINT     approval_status     "스냅샷"
        BIGINT      approved_by         "스냅샷, NULL허용"
        DATETIME    approved_at         "스냅샷, NULL허용"
        VARCHAR500  reject_reason       "스냅샷, NULL허용"
        JSON        reward_data         "스냅샷"
        BIGINT      created_by          "이 행위자(FK없음)"
        VARCHAR50   created_by_name     "행위자명 스냅샷, NULL허용"
        DATETIME    created_at
    }

    log_coupon_use {
        BIGINT      idx                 PK
        TINYINT     action              "10:RESERVE, 20:CONFIRM"
        BIGINT      project_id          "FK없음(로그원칙)"
        BIGINT      coupon_campaign_id  "FK없음, NULL허용"
        VARCHAR50   code_value          "FK아님, 존재하지 않는 코드도 기록"
        VARCHAR100  game_user_id        "FK없음"
        TINYINT     result_type         "0:성공, 그외:실패사유(20_COUPON_USAGE_API.md 4장 매핑)"
        VARCHAR45   caller_ip           "NULL허용, 인증목적아님(보조신호)"
        DATETIME    created_at
    }

    project_api_nonce {
        BIGINT      project_api_nonce_id    PK
        BIGINT      project_id              FK
        VARCHAR64   nonce                   "UK(project_id+nonce)"
        DATETIME    created_at
    }

    %% ── 핵심 구조 관계 ──────────────────────────────
    company  ||--|{  project      : "소속"
    company  ||--|{  user         : "소속"
    project  ||--o{  user_role    : "권한부여"
    user     ||--o{  user_role    : "권한보유"
    project  ||--o{  project_api_nonce : "S2S 재전송 방지"

    %% ── 쿠폰 도메인 관계 ─────────────────────────────
    project          ||--o{  coupon_campaign     : "소유"
    coupon_campaign  ||--o{  coupon_code         : "코드 발급"
    coupon_code      ||--o{  coupon_code_usage   : "사용 기록"

    %% ── 선택적 참조 ─────────────────────────────────
    project  |o--o{  user         : "가입신청(requested_project_id)"
```

---

## FK 미적용 항목

| 테이블 | 컬럼 | 이유 |
|--------|------|------|
| `user_session` | `user_id` | MySQL → Redis 저장소 전환 시 인증 로직 수정 없이 확장 가능하도록 설계(2026-08-05: 저장소 이관이 아니라 `SessionCacheService` 읽기 캐시로 실제 구현 — `09_AUTH_SECURITY.md` 1.3.1) |
| `log_audit` | 전체 (`company_id`/`project_id`/`created_by` 포함) | Append-Only 로그 테이블 원칙 — FK 없음. 실 운영 환경에서 메인 서비스 DB와 별도인 VM/DB에 둔다는 확정 전제([04_DEV_CONVENTIONS.md](./04_DEV_CONVENTIONS.md) 1장 참고) |
| `log_coupon_campaign` | 전체 (`coupon_campaign_id`/`project_id`/`created_by` 포함) | 위와 동일한 로그 원칙 — 원본 스냅샷이라 원본 삭제/변경과 무관하게 값 보존 필요 |
| `log_coupon_use` | 전체 (`project_id`/`coupon_campaign_id`/`created_by` 포함) | 위와 동일. `code_value`도 FK 아님 — 존재하지 않는 코드로 시도한 요청도 그대로 기록해야 하므로 |

## 비정규화 FK 컬럼

로그 테이블과 달리 아래는 실제 FK 제약이 걸려 있지만, 상위 엔티티를 거치지 않고 바로 조회/스코핑하기 위해 의도적으로 중복 저장한 컬럼이다.

| 테이블 | 컬럼 | 원본 경로 | 목적 |
|--------|------|-----------|------|
| `coupon_code` | `project_id` | `coupon_campaign.project_id` | `code_value` 유니크 범위를 프로젝트 단위로 스코핑, reserve 조회 시 프로젝트 소속 검증 |
| `coupon_code_usage` | `coupon_campaign_id` | `coupon_code.coupon_campaign_id` | 사용한도 카운트/미컨슘 조회 |
| `coupon_code_usage` | `project_id` | `coupon_code.project_id` | 미컨슘 조회 API의 크로스테넌트 스코핑 (`game_user_id` 값이 프로젝트 간 우연히 겹칠 수 있어 필요) |

---

## 상태 코드 요약

| 테이블 | 컬럼 | 값 |
|--------|------|----|
| company, project, user_role, user_session | status | 1:사용 / 0:중지 (user_session은 0:로그아웃) |
| user | status | 0:가입승인대기 / 1:가입승인 / 2:가입반려 / 3:사용중지 |
| user_session | status | 1:사용 / 0:로그아웃 / 2:만료 |
| user_role | role_code | 10:SUPER_ADMIN / 20:DEVELOPER / 30:MANAGER / 40:OPERATOR |
| log_audit | action | 10:CREATE / 20:UPDATE / 30:STATUS_CHANGE |
| coupon_campaign | code_type | 1:RANDOM / 2:FIXED |
| coupon_campaign | status | 1:대기 / 2:활성 / 3:일시중지 / 4:종료 |
| coupon_campaign | approval_status | 1:승인불요 / 2:승인대기 / 3:승인완료 / 4:반려 (status와 별개 축) |
| coupon_campaign | generation_status | 1:대기 / 2:진행중 / 3:완료 / 4:실패 (status/approval_status와 별개 축) |
| coupon_code | status | 0:중지 / 1:미사용(RANDOM)·사용중(FIXED) / 2:사용완료(RANDOM 전용) |
| log_coupon_campaign | action | 10:CREATE / 20:UPDATE / 30:STATUS_CHANGE / 40:APPROVE / 50:REJECT |
| log_coupon_use | action | 10:RESERVE / 20:CONFIRM |
| log_coupon_use | result_type | 0:성공 / 10:코드없음 / 20:이미소모·중지 / 30:캠페인 사용불가 / 40:사용자한도초과 / 50:소모기록없음(CONFIRM 전용) — API result 코드 매핑은 [20_COUPON_USAGE_API.md](./20_COUPON_USAGE_API.md) 4장 참고 |
