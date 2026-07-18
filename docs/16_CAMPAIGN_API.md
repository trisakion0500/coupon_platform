# 16_CAMPAIGN_API.md

# Coupon Platform REST API Specification — Campaign / Coupon Code

---

# 1. Common Rules

## 1.1 Response Format

공통 응답 포맷/에러코드는 [07_API_COMMON.md](./07_API_COMMON.md)를 따른다.

## 1.2 Role Definition

Role Code 표 자체는 [09_COMPANY_API.md](./09_COMPANY_API.md) 1.2를 따른다. 쿠폰 도메인(캠페인/코드) 컨트롤 권한 세부는 그동안 "쿠폰 도메인 설계 시점에 정의"로 미뤄뒀던 부분이며, 본 절에서 최초로 확정한다.

### SUPER_ADMIN

- 모든 프로젝트의 캠페인/코드 전체 컨트롤(생성/수정/상태변경/코드발급/승인/반려) 가능

### DEVELOPER

- `user_role`에 실제로 **활성 배정된 `project_id`**의 캠페인/코드만 조회/컨트롤 가능 — [10_PROJECT_API.md](./10_PROJECT_API.md) 2.5 Rotate Project API Secret과 동일한 프로젝트 단위 스코핑 원칙. DEVELOPER의 프로젝트 관리메뉴 조회(2.2 Get Project List 등)는 회사 단위로 넓지만, 그건 "조회"에 한정된 예외이고 실제 컨트롤(쓰기) 액션은 배정된 프로젝트로 좁힌다는 게 기존 선례 — 쿠폰 도메인은 생성/수정/승인 등 컨트롤(쓰기) 중심이라 이 선례를 따른다
- 승인 가능(`approval_status` 2→3/4) — 자신이 활성 배정된 프로젝트 범위 내에서만

### MANAGER

- `user_role`에 실제로 활성 배정된 `project_id`의 캠페인/코드만 컨트롤 가능(DEVELOPER와 동일한 프로젝트 단위 스코핑)
- 생성 시 즉시 `approval_status=1`(승인불요)로 시작
- 승인 가능(`approval_status` 2→3/4) — 단, 자신이 활성 배정된 프로젝트 범위 내에서만

### OPERATOR

- `user_role`에 실제로 활성 배정된 `project_id`의 캠페인/코드만 컨트롤 가능(DEVELOPER/MANAGER와 동일한 프로젝트 단위 스코핑)
- 생성 시 `approval_status=2`(승인대기)로 시작 — SUPER_ADMIN/DEVELOPER/MANAGER가 승인
- 승인/반려 불가(자신이 만든 캠페인도 스스로 승인 못 함)

### 스코핑 요약

| Role        | 스코핑 기준                              |
| ----------- | ----------------------------------------- |
| SUPER_ADMIN | 전체                                       |
| DEVELOPER   | `project_id` (`user_role` 활성 배정 프로젝트만) |
| MANAGER     | `project_id` (`user_role` 활성 배정 프로젝트만) |
| OPERATOR    | `project_id` (`user_role` 활성 배정 프로젝트만) |

DEVELOPER/MANAGER/OPERATOR 모두 스코핑 기준 자체는 동일(프로젝트 단위)하고, 역할별 차이는 승인 필요 여부·승인 권한 유무뿐이다. 스코핑 범위 밖의 `project_id`/`coupon_campaign_id`에 접근하면 20001(권한 없음)을 반환한다.

---

# 2. Campaign APIs

## 2.1 Create Campaign

### Endpoint

```http
POST /campaigns
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만)

### Request

```json
{
  "project_id": 10,
  "name": "여름 이벤트 쿠폰",
  "campaign_start": "2026-08-01 00:00:00",
  "campaign_end": "2026-08-31 23:59:59",
  "code_type": 1,
  "use_hyphen": 1,
  "requested_qty": 1000,
  "use_limit_per_user": 1,
  "reward_data": { "item_id": 5001, "qty": 3 }
}
```

### Validation

- `project_id` 존재 + 호출자 스코핑 범위 내
- `name` 필수, 최대 100자
- `campaign_start`/`campaign_end` 필수, `campaign_end > campaign_start`
- `code_type` 필수, `1`(RANDOM) 또는 `2`(FIXED)
- `use_hyphen`은 `code_type=1`(RANDOM)일 때만 의미 있음(FIXED는 무시)
- `requested_qty`는 `code_type=1`(RANDOM)일 때 필수, `1` 이상
- `use_limit_per_user` 1 이상(기본 1)
- `reward_data` 필수(JSON), 쿠폰서버는 내용을 해석하지 않고 그대로 저장([03_DATABASE_SCHEMA.md](./03_DATABASE_SCHEMA.md) 6장 참고)

### Business Rules

- **`approval_status` 자동 결정**: 호출자 `role_code <= 30`(SUPER_ADMIN/DEVELOPER/MANAGER)이면 `1`(승인불요), `role_code = 40`(OPERATOR)이면 `2`(승인대기)
- **`code_type=2`(FIXED)면 `requested_qty`는 요청값과 무관하게 항상 `1`로 서버가 고정한다** — FIXED는 캠페인당 코드 1건만 존재하며(3.1 참고), `requested_qty`/`generated_qty` 비교로 "완료" 여부를 판단하는 로직을 RANDOM과 동일하게 재사용하기 위한 것일 뿐 코드 개수를 의미하지 않는다
- `status` 기본값 `1`(대기), `generation_status` 기본값 `1`(대기), `usable_qty`/`generated_qty`/`used_qty` 기본값 `0`
- `usable_qty`는 생성 시점엔 항상 `0`이다 — 코드 발급 완료 후 관리자가 [2.4 Update Campaign](#24-update-campaign)으로 별도로 오픈한다
- `created_by`/`updated_by`는 JWT `user_id`
- `log_coupon_campaign`에 `action=10`(CREATE) 스냅샷 기록. 로그 실패는 메인 트랜잭션을 막지 않는다(CLAUDE.md 원칙)

### Response

```json
{
  "result": 0,
  "data": {
    "coupon_campaign_id": 100,
    "project_id": 10,
    "name": "여름 이벤트 쿠폰",
    "campaign_start": "2026-08-01 00:00:00",
    "campaign_end": "2026-08-31 23:59:59",
    "code_type": 1,
    "use_hyphen": 1,
    "requested_qty": 1000,
    "generated_qty": 0,
    "generation_status": 1,
    "generation_error": null,
    "usable_qty": 0,
    "used_qty": 0,
    "use_limit_per_user": 1,
    "status": 1,
    "approval_status": 2,
    "approved_by": null,
    "approved_at": null,
    "reject_reason": null,
    "reward_data": { "item_id": 5001, "qty": 3 },
    "created_by": 4,
    "updated_by": 4,
    "created_at": "2026-07-17 10:00:00",
    "updated_at": "2026-07-17 10:00:00"
  }
}
```

---

## 2.2 Get Campaign List

### Endpoint

```http
GET /campaigns
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만)

### Query Parameters

| Name             | Required | Description                        |
| ---------------- | -------- | ----------------------------------- |
| project_id       | Y        | 스코핑 범위 밖이면 20001            |
| status           | N        |                                     |
| approval_status  | N        |                                     |
| generation_status| N        |                                     |
| code_type        | N        |                                     |
| page             | Y        |                                     |
| page_size        | Y        | 20/30/50/100 중 선택. 기본 20        |

### Sorting

```sql
ORDER BY status DESC,
         created_at DESC
```

### Response

페이지네이션 응답 형식([07_API_COMMON.md](./07_API_COMMON.md) 2장 참고).

```json
{
  "result": 0,
  "data": {
    "page": 1,
    "page_size": 20,
    "total_count": 5,
    "items": [
      {
        "coupon_campaign_id": 100,
        "project_id": 10,
        "name": "여름 이벤트 쿠폰",
        "code_type": 1,
        "requested_qty": 1000,
        "generated_qty": 1000,
        "generation_status": 3,
        "usable_qty": 500,
        "used_qty": 120,
        "status": 2,
        "approval_status": 3,
        "campaign_start": "2026-08-01 00:00:00",
        "campaign_end": "2026-08-31 23:59:59",
        "created_at": "2026-07-17 10:00:00",
        "updated_at": "2026-07-17 10:00:00"
      }
    ]
  }
}
```

---

## 2.3 Get Campaign

### Endpoint

```http
GET /campaigns/{coupon_campaign_id}
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만)

미존재/스코핑 범위 밖이면 31004.

---

## 2.4 Update Campaign

### Endpoint

```http
PATCH /campaigns/{coupon_campaign_id}
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만)

### Updatable Fields

```text
name
campaign_start
campaign_end
use_limit_per_user
usable_qty
reward_data
```

### Non-Updatable Fields

```text
coupon_campaign_id
project_id
code_type            (변경 시 코드 발급 규칙 자체가 달라짐 — 새 캠페인으로 생성)
use_hyphen
requested_qty        (코드 발급 job은 캠페인당 1회뿐이라 발급 목표량은 고정값)
generated_qty        (2.6/2.7이 아닌 3장 코드 발급 API 전용)
generation_status / generation_error
used_qty
status               (2.5 Change Campaign Status 전용)
approval_status / approved_by / approved_at / reject_reason (2.6/2.7 전용, 단 아래 Business Rules에 의해 approval_status는 부수효과로 변경될 수 있음)
```

### Validation

- `campaign_end > campaign_start`
- `usable_qty <= generated_qty` (아직 발급되지 않은 수량보다 많이 열 수 없음)
- `name` 최대 100자, `use_limit_per_user` 1 이상

### Business Rules

- **수정 시 재승인**: 수정 직전 `approval_status`가 `3`(승인완료) 또는 `4`(반려)였다면, 수정과 동시에 `2`(승인대기)로 재전환한다 — 누가 수정하든(예: MANAGER가 OPERATOR 캠페인을 대신 수정하는 경우 포함) 동일하게 적용, 이미 승인된 내용을 승인 절차 없이 바꾸는 우회를 막기 위함. `approval_status`가 `1`(승인불요) 또는 이미 `2`(승인대기)였다면 그대로 유지한다
- **활성 캠페인 보호**: 위 재승인 전환이 발생하는 동시에 `status`가 `2`(활성)였다면 `status`도 `3`(일시중지)로 강제 전환한다 — 활성 서비스 중인 캠페인이 미승인 내용으로 계속 노출되는 상황을 막기 위함(재활성화는 재승인 후 [2.5](#25-change-campaign-status)로 관리자가 다시 수행)
- `log_coupon_campaign`에 `action=20`(UPDATE) 스냅샷 기록(위 부수효과로 `approval_status`/`status`가 함께 바뀐 경우, 바뀐 이후 값 기준으로 1행만 기록 — 별도 STATUS_CHANGE 행을 추가로 남기지 않음)

### Response

수정 후 최종 데이터 반환

---

## 2.5 Change Campaign Status

### Endpoint

```http
POST /campaigns/{coupon_campaign_id}/status
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만)

### Request

```json
{
  "status": 2
}
```

### Allowed State Transition

| From        | To          | 추가 조건                              |
| ----------- | ----------- | --------------------------------------- |
| 1(대기)     | 2(활성)     | `approval_status IN (1,3)` 필요           |
| 1(대기)     | 4(종료)     | 활성화 전 취소                          |
| 2(활성)     | 3(일시중지) | -                                       |
| 2(활성)     | 4(종료)     | -                                       |
| 3(일시중지) | 2(활성)     | `approval_status IN (1,3)` 필요(재확인)   |
| 3(일시중지) | 4(종료)     | -                                       |

`4`(종료)는 최종 상태이며 이후 전이가 없다. 표에 없는 조합(예: `1→3`)과 승인 조건 미충족은 30004(상태 전이 불가)를 반환한다.

### Business Rules

- 조건부 UPDATE로 원자성 확보:
  ```sql
  UPDATE coupon_campaign SET status=?
  WHERE coupon_campaign_id=? AND status=? [AND approval_status IN (1,3)]
  ```
- `log_coupon_campaign`에 `action=30`(STATUS_CHANGE) 스냅샷 기록

### Response

변경 후 최종 데이터 반환

---

## 2.6 Approve Campaign

### Endpoint

```http
POST /campaigns/{coupon_campaign_id}/approve
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER (스코핑 내 `project_id`만 — OPERATOR는 승인 불가)

### State Transition

```text
2(승인대기) → 3(승인완료)
```

`approval_status=2`가 아니면 30004.

### Business Rules

- `approved_by`(호출자 `user_id`)/`approved_at`(현재시각) 기록
- `log_coupon_campaign`에 `action=40`(APPROVE) 스냅샷 기록

### Response

승인 후 최종 데이터 반환

---

## 2.7 Reject Campaign

### Endpoint

```http
POST /campaigns/{coupon_campaign_id}/reject
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER (스코핑 내 `project_id`만)

### Request

```json
{
  "reject_reason": "보상 아이템 ID 확인 필요"
}
```

### Validation

- `reject_reason` 필수, 최대 500자

### State Transition

```text
2(승인대기) → 4(반려)
```

`approval_status=2`가 아니면 30004.

### Business Rules

- `approved_by`/`approved_at`/`reject_reason` 기록(승인과 동일한 스냅샷 컬럼 사용 — [03_DATABASE_SCHEMA.md](./03_DATABASE_SCHEMA.md) 6장 참고)
- 반려 후 재제출하려면 [2.4 Update Campaign](#24-update-campaign)으로 수정 — 수정 즉시 `approval_status`가 `2`(승인대기)로 재전환되어 자동으로 재상신된다(별도 "재제출 API" 없음)
- `log_coupon_campaign`에 `action=50`(REJECT) 스냅샷 기록

### Response

반려 후 최종 데이터 반환

---

# 3. Coupon Code Issuance APIs

흐름/재시도 알고리즘과 "왜 FIXED는 캠페인당 코드 1건뿐인가" 등 설계 근거는 [04_COUPON_ISSUANCE_SCENARIO.md](./04_COUPON_ISSUANCE_SCENARIO.md) 2장 참고. 본 장은 상세 요청/응답 스키마만 다룬다.

## 3.1 Issue Codes

### Endpoint

```http
POST /campaigns/{coupon_campaign_id}/codes
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만) — **`approval_status`와 무관하게 호출 가능**(코드 발급은 승인 워크플로우와 독립적, [04_COUPON_ISSUANCE_SCENARIO.md](./04_COUPON_ISSUANCE_SCENARIO.md) 1장 참고)

### Precondition

`generation_status=1`(대기)일 때만 허용(캠페인당 1회) — 아니면 30004.

### Request — RANDOM (`code_type=1`)

Body 없음. 캠페인 생성 시 저장된 `requested_qty`/`use_hyphen`을 그대로 사용한다.

### Request — FIXED (`code_type=2`)

```json
{
  "code_value": "SUMMER2024"
}
```

### Validation (FIXED)

- `code_value` 필수, 1~50자, 관리자가 입력한 값 그대로 사용(시스템이 대소문자/하이픈 등을 가공하지 않음)
- 동일 `project_id` 내 중복 불가(`UNIQUE(project_id, code_value)`) — 중복이면 32001, `generation_status`는 `1`(대기) 그대로 유지되어 재요청 가능

### Business Rules

- **RANDOM**: 호출 즉시 `generation_status=2`(진행중)로 전환 후 `202 Accepted` 응답, 백그라운드로 `requested_qty`만큼 대량 생성. 코드값 충돌은 즉시 재생성, DB 일시 오류는 backoff+jitter 재시도, 재시도 소진 시 `generation_status=4`(실패) + `generation_error` 기록([04_COUPON_ISSUANCE_SCENARIO.md](./04_COUPON_ISSUANCE_SCENARIO.md) 2.2 참고). 전량 생성 완료 시 `generation_status=3`(완료)
- **FIXED**: 동기 처리, 성공 시 `coupon_code` 1행 생성 + `generated_qty=1`(=`requested_qty`), `generation_status=3`(완료)로 즉시 `200 OK` 응답. FIXED는 `generation_status=4`(실패) 상태에 도달하지 않는다(재시도 인프라 대상이 아님 — 실패 시 그냈로 재요청)

### Response — RANDOM (202 Accepted)

```json
{
  "result": 0,
  "data": {
    "coupon_campaign_id": 100,
    "generation_status": 2
  }
}
```

### Response — FIXED (200 OK)

```json
{
  "result": 0,
  "data": {
    "coupon_campaign_id": 100,
    "generation_status": 3,
    "generated_qty": 1,
    "coupon_code": {
      "coupon_code_id": 5000,
      "code_value": "SUMMER2024",
      "status": 1
    }
  }
}
```

---

## 3.2 Retry Code Issuance

### Endpoint

```http
POST /campaigns/{coupon_campaign_id}/codes/retry
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만)

### Precondition

`generation_status=4`(실패)일 때만 허용 — RANDOM 전용(FIXED는 이 상태에 도달하지 않으므로 사실상 호출 대상이 아님). 아니면 30004.

### Business Rules

- 조건부 UPDATE로 원자성 확보:
  ```sql
  UPDATE coupon_campaign SET generation_status=2
  WHERE coupon_campaign_id=? AND generation_status=4
  ```
- 이미 생성된 `generated_qty`만큼의 코드는 그대로 두고, 남은 수량(`requested_qty - generated_qty`)만 이어서 생성한다

### Response

```json
{
  "result": 0,
  "data": {
    "coupon_campaign_id": 100,
    "generation_status": 2
  }
}
```

---

## 3.3 Get Coupon Code List

### Endpoint

```http
GET /campaigns/{coupon_campaign_id}/codes
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만)

### Query Parameters

| Name      | Required | Description                   |
| --------- | -------- | ------------------------------ |
| status    | N        |                                |
| page      | Y        |                                |
| page_size | Y        | 20/30/50/100 중 선택. 기본 20  |

### Response

페이지네이션 응답 형식([07_API_COMMON.md](./07_API_COMMON.md) 2장 참고). FIXED는 항상 최대 1건.

```json
{
  "result": 0,
  "data": {
    "page": 1,
    "page_size": 20,
    "total_count": 1000,
    "items": [
      {
        "coupon_code_id": 5001,
        "code_value": "23A4-B7C9-DEF2",
        "status": 1,
        "created_at": "2026-07-17 10:05:00"
      }
    ]
  }
}
```

---

# 4. 관련 문서

- 캠페인/코드 발급 흐름 근거: [04_COUPON_ISSUANCE_SCENARIO.md](./04_COUPON_ISSUANCE_SCENARIO.md)
- 테이블 DDL: `database/tables/coupon_campaign.sql`, `coupon_code.sql`, `log_coupon_campaign.sql`
- 공통 응답/에러코드: [07_API_COMMON.md](./07_API_COMMON.md)

**아직 미확정(TODO)**: 쿠폰 사용(reserve/confirm) 상세 API 스펙, S2S 인증 세부 스펙 — CLAUDE.md TODO 참고.
