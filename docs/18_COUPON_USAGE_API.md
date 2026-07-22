# 18_COUPON_USAGE_API.md

# Coupon Platform REST API Specification — Coupon Usage (Reserve / Confirm)

---

# 1. Common Rules

## 1.1 Response Format

공통 응답 포맷/에러코드는 [08_API_COMMON.md](./08_API_COMMON.md)를 따른다.

## 1.2 Permission

본 장의 API는 관리 콘솔 사용자가 아니라 **게임서버가 S2S로 호출**한다. `user_role`(SUPER_ADMIN/DEVELOPER/MANAGER/OPERATOR) 체계와 무관하며, 인증은 `project.api_key` + HMAC-SHA256 요청 서명으로 이루어진다([07_AUTH_SECURITY.md](./07_AUTH_SECURITY.md) 2장). `project_id`는 이 인증으로 자동 스코핑되므로 이후 각 API의 요청/쿼리에 `project_id`를 별도로 받지 않는다.

모든 요청에 아래 헤더가 필요하다(상세 서명 규칙/검증 순서는 [07_AUTH_SECURITY.md](./07_AUTH_SECURITY.md) 2.2~2.5 참고).

```text
X-API-Key
X-API-Timestamp
X-API-Nonce
X-API-Signature
```

## 1.3 API 버전

S2S API이므로 [07_AUTH_SECURITY.md](./07_AUTH_SECURITY.md) 2.7의 버전 정책이 적용된다. 아래 모든 엔드포인트는 `/v1` 접두어를 붙인다(예: `POST /v1/coupons/{code}/reserve`). [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md)의 시퀀스 다이어그램은 버전 정책 확정 이전에 그려진 것이라 `/v1` 없이 표기되어 있다 — 실제 스펙은 본 문서 기준을 따른다.

## 1.4 코드/사용자 식별

- `{code}` 경로 파라미터 = `coupon_code.code_value`. 조회는 항상 `WHERE project_id=? AND code_value=?`로 스코핑되어 다른 프로젝트 소속 코드는 존재하지 않는 것과 동일하게 처리된다([06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md) 1.2 참고)
- `game_user_id`는 관리 콘솔 `user`와 무관한 게임서버 자체 유저 식별자다. FK 없이 원문 문자열 그대로 저장한다(길이 제약은 [08_API_COMMON.md](./08_API_COMMON.md) 7장 참고)

## 1.5 로그 기록

본 장의 모든 API는 성공/실패 여부와 무관하게 매 호출마다 `log_coupon_use`에 `action`(10:RESERVE, 20:CONFIRM)과 `result_type` 스냅샷을 기록한다(3장 참고). 로그 기록 실패/지연은 메인 트랜잭션을 막지 않는다(CLAUDE.md 원칙).

---

# 2. Coupon Usage APIs

## 2.1 Reserve Coupon

### Endpoint

```http
POST /v1/coupons/{code}/reserve
```

### Permission

S2S (1.2 참고)

### Request

```json
{
  "game_user_id": "player_1001"
}
```

### Validation

- `game_user_id` 필수, 최대 100자

### Processing (요약 — 상세 흐름/동시성 근거는 [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md) 2장 참고)

1. `coupon_code` 조회 (`project_id`+`code_value`) — 없으면 31005
2. **멱등 체크**(`use_limit_per_user=1`일 때만): `(coupon_code_id, game_user_id)` 매칭 기존 `coupon_code_usage` 행이 있으면 새로 만들지 않고 그 행 그대로 200 OK 반환(재시도 응답 재현, [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md) 1.2 참고)
3. `code_type`별 코드 잠금/검증
   - RANDOM: `UPDATE coupon_code SET status=2 WHERE coupon_code_id=? AND status=1` 조건부 갱신 0건 → 33001
   - FIXED: `status=1`(사용중) 아니면 → 33001
4. `UPDATE coupon_campaign SET used_qty=used_qty+1 WHERE used_qty<usable_qty AND status=2 AND NOW() BETWEEN campaign_start AND campaign_end` 조건부 갱신 0건 → 33002 (트랜잭션 롤백으로 3번의 코드 잠금도 함께 해제)
5. `SELECT COUNT(*) FROM coupon_code_usage WHERE coupon_campaign_id=? AND game_user_id=? FOR UPDATE` 확인 후 `use_limit_per_user` 초과 → 33003 (트랜잭션 롤백)
6. `coupon_code_usage` 행 생성(소모 확정) → 200 OK

### Business Rules

- reserve 성공 = 즉시 최종 소모 확정(예약 중간 상태 없음). 이후 confirm은 상태를 바꾸지 않고 지급 결과만 기록한다
- **reserve는 `use_limit_per_user=1`일 때 멱등이다** — 같은 코드+같은 `game_user_id`로 재시도하면 새 소모를 만들지 않고 최초 성공 응답(`reward_data` 포함)을 그대로 재반환한다. `use_limit_per_user>1`인 FIXED 코드는 정당한 반복 사용과 재시도를 구분할 방법이 없어 이 멱등 처리를 적용하지 않는다(알려진 한계, [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md) 1.2 참고)
- 하나의 `game_user_id`가 같은 코드에 중복 reserve를 시도해도(멱등 체크 대상이 아닌 경우) 별도 예외 처리를 두지 않는다 — RANDOM은 이미 소모완료라 33001로, FIXED는 사용자당 한도(`use_limit_per_user`)로 자연히 걸러진다

### Response

```json
{
  "result": 0,
  "data": {
    "coupon_code_usage_id": 9000,
    "coupon_campaign_id": 100,
    "code_value": "23A4-B7C9-DEF2",
    "game_user_id": "player_1001",
    "reward_data": { "item_id": 5001, "qty": 3 },
    "created_at": "2026-07-18 10:00:00"
  }
}
```

`reward_data`(캠페인의 보상 내용)를 이 응답에 바로 포함한다 — 게임서버가 별도 조회 없이 즉시 자체 DB에 지급 처리를 할 수 있어야 하기 때문이다.

### Errors

| Result Code | HTTP | 설명 |
|---|---|---|
| 30001 | 400 | `game_user_id` 누락 |
| 31005 | 404 | 쿠폰 코드 없음 |
| 33001 | 400 | 코드 이미 소모됨/중지됨 |
| 33002 | 400 | 캠페인 사용 불가 |
| 33003 | 400 | 사용자 사용 한도 초과 |

---

## 2.2 Confirm Coupon

### Endpoint

```http
POST /v1/coupons/{code}/confirm
```

### Permission

S2S (1.2 참고)

### Request

```json
{
  "game_user_id": "player_1001"
}
```

### Validation

- `game_user_id` 필수, 최대 100자

### Processing

1. `coupon_code` 조회 (`project_id`+`code_value`) — 없으면 31005
2. `coupon_code_usage` 조회 (`coupon_code_id`+`game_user_id` 매칭) — 없으면 31006 (reserve를 먼저 호출한 적 없거나, reserve 때와 다른 `game_user_id`로 호출한 경우 포함)
3. 이미 `confirmed_at`이 있으면 상태 변경 없이 기존 값 그대로 200 OK (멱등 처리)
4. 없으면 `confirmed_at = NOW()` 기록 후 200 OK

### Business Rules

- confirm은 `coupon_code`/`coupon_campaign`의 어떤 상태도 바꾸지 않는다 — 소모 확정은 이미 reserve에서 끝났고, confirm은 지급 결과 보고일 뿐이다
- 재시도로 두 번 이상 호출돼도 무해하므로 별도 락을 걸지 않는다([06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md) 2.2 참고)

### Response

```json
{
  "result": 0,
  "data": {
    "coupon_code_usage_id": 9000,
    "confirmed_at": "2026-07-18 10:00:05"
  }
}
```

### Errors

| Result Code | HTTP | 설명 |
|---|---|---|
| 30001 | 400 | `game_user_id` 누락 |
| 31005 | 404 | 쿠폰 코드 없음 |
| 31006 | 404 | 소모 기록 없음(reserve 안 된 코드에 confirm 시도) |

---

# 3. Unconfirmed Query API

confirm이 안 온 소모 건을 게임서버가 스스로 조회해 재처리할 수 있도록 제공한다(설계 근거는 [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md) 3장 참고). 특정유저 조회와 전체유저 조회를 엔드포인트 하나로 통합하고, `game_user_id` 지정 여부로 동작이 갈린다.

## 3.1 Get Unconfirmed Coupon Usages

### Endpoint

```http
GET /v1/coupons/unconfirmed
```

### Permission

S2S (1.2 참고)

### Query Parameters

| Name          | Required | Description |
|---------------|----------|--------------|
| game_user_id  | N        | 지정 시 "특정유저 조회" 모드(페이지네이션 미적용, 전체 반환). 미지정 시 "전체유저 조회" 모드(페이지네이션 필수) |
| campaign_id   | N        | 두 모드 공통 선택 필터 |
| page          | 조건부   | `game_user_id` 미지정 시 필수 |
| page_size     | 조건부   | `game_user_id` 미지정 시 필수. 20/30/50/100 중 선택. 기본 20 |

### Validation

- `game_user_id` 미지정 상태에서 `page`/`page_size` 누락 → 30001

### Sorting

```sql
ORDER BY created_at ASC
```

게임서버가 오래된 미지급 건부터 재처리하기 유리하도록 오래된 순으로 고정한다(관리 콘솔의 로그성 조회가 최신순인 것과 반대 — 이 API는 사람이 훑어보는 화면이 아니라 게임서버의 리컨실리에이션 배치가 순차 처리하는 대상이라 목적이 다르다).

### Business Rules

- 두 모드 모두 실제 쿼리는 `coupon_code_usage.project_id`(비정규화 컬럼) 기준으로 스코핑하고, `confirmed_at IS NULL` 조건은 공통이다
- `game_user_id`만으로 조회하는 특정유저 모드도 내부적으로 `WHERE project_id=? AND game_user_id=?`로 스코핑해 다른 프로젝트의 동일 `game_user_id` 데이터가 섞이지 않는다([06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md) 3.2 참고)

### Response — 특정유저 조회 (`game_user_id` 지정)

```json
{
  "result": 0,
  "data": {
    "items": [
      {
        "code_value": "23A4-B7C9-DEF2",
        "game_user_id": "player_1001",
        "coupon_campaign_id": 100,
        "reward_data": { "item_id": 5001, "qty": 3 },
        "created_at": "2026-07-18 10:00:00"
      }
    ]
  }
}
```

### Response — 전체유저 조회 (`game_user_id` 미지정)

페이지네이션 응답 형식([08_API_COMMON.md](./08_API_COMMON.md) 2장 참고).

```json
{
  "result": 0,
  "data": {
    "page": 1,
    "page_size": 20,
    "total_count": 5,
    "items": [
      {
        "code_value": "23A4-B7C9-DEF2",
        "game_user_id": "player_1001",
        "coupon_campaign_id": 100,
        "reward_data": { "item_id": 5001, "qty": 3 },
        "created_at": "2026-07-18 10:00:00"
      }
    ]
  }
}
```

### Errors

| Result Code | HTTP | 설명 |
|---|---|---|
| 30001 | 400 | 전체유저 조회 모드에서 `page`/`page_size` 누락 |

---

# 4. log_coupon_use 매핑

`log_coupon_use.result_type`(잠정 코드)과 본 문서 API result 코드의 대응 관계.

| result_type | 의미 | API Result Code |
|---|---|---|
| 0 | 성공 | 0 |
| 10 | 코드없음(RESERVE) | 31005 |
| 20 | 이미소모/중지(RESERVE) | 33001 |
| 30 | 캠페인 사용불가(RESERVE) | 33002 |
| 40 | 사용자한도초과(RESERVE) | 33003 |
| 50 | 소모기록없음(CONFIRM 전용) | 31006 |

CONFIRM의 코드없음(31005)은 RESERVE와 원인이 같으므로 `result_type=10`을 그대로 공유한다(별도 코드 추가 없음).

---

# 5. 관련 문서

- 쿠폰 사용 흐름/동시성 설계 근거: [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md)
- 테이블 DDL: `database/tables/coupon_campaign.sql`, `coupon_code.sql`, `coupon_code_usage.sql`, `log_coupon_use.sql`, `project_api_nonce.sql`
- 공통 응답/에러코드: [08_API_COMMON.md](./08_API_COMMON.md)
- S2S 인증(HMAC 서명/헤더/재전송 방지): [07_AUTH_SECURITY.md](./07_AUTH_SECURITY.md) 2장

본 장의 모든 엔드포인트는 각자의 Errors 표에 없더라도 인증 단계 실패 시 아래 result 코드를 공통으로 반환할 수 있다(2장 참고).

| Result Code | HTTP | 설명 |
|---|---|---|
| 10010 | 401 | API Key 없음/유효하지 않음 |
| 10011 | 401 | 서명(Signature) 불일치 |
| 10012 | 401 | 필수 인증 헤더 누락/형식 오류 |
| 10013 | 401 | Timestamp 허용범위 초과 |
| 10014 | 401 | 프로젝트 사용중지 |
| 10015 | 401 | Nonce 재사용 감지(재전송 의심) |
