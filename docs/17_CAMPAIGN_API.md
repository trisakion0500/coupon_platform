# 17_CAMPAIGN_API.md

# Coupon Platform REST API Specification — Campaign / Coupon Code

---

# 1. Common Rules

## 1.1 Response Format

공통 응답 포맷/에러코드는 [08_API_COMMON.md](./08_API_COMMON.md)를 따른다.

## 1.2 Role Definition

Role Code 표 자체는 [10_COMPANY_API.md](./10_COMPANY_API.md) 1.2를 따른다. 쿠폰 도메인(캠페인/코드) 컨트롤 권한 세부는 그동안 "쿠폰 도메인 설계 시점에 정의"로 미뤄뒀던 부분이며, 본 절에서 최초로 확정한다.

### SUPER_ADMIN

- 모든 프로젝트의 캠페인/코드 전체 컨트롤(생성/수정/상태변경/코드발급/승인/반려) 가능

### DEVELOPER

- `user_role`에 실제로 **활성 배정된 `project_id`**의 캠페인/코드만 조회/컨트롤 가능 — [11_PROJECT_API.md](./11_PROJECT_API.md) 2.5 Rotate Project API Secret과 동일한 프로젝트 단위 스코핑 원칙. DEVELOPER의 프로젝트 관리메뉴 조회(2.2 Get Project List 등)는 회사 단위로 넓지만, 그건 "조회"에 한정된 예외이고 실제 컨트롤(쓰기) 액션은 배정된 프로젝트로 좁힌다는 게 기존 선례 — 쿠폰 도메인은 생성/수정/승인 등 컨트롤(쓰기) 중심이라 이 선례를 따른다
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

DEVELOPER/MANAGER/OPERATOR 모두 스코핑 기준 자체는 동일(프로젝트 단위)하고, 역할별 차이는 승인 필요 여부·승인 권한 유무뿐이다. 스코핑 범위 밖의 `project_id`/`coupon_campaign_id`에 접근하면 20001(권한 없음)을 반환한다 — `coupon_campaign_id`가 아예 존재하지 않는 경우(31004)와는 구분한다.

## 1.3 종료된 캠페인(`status=4`) 잠금 원칙

`status=4`(종료)는 캠페인 라이프사이클의 최종 상태([2.5](#25-change-campaign-status) 참고)이며, 도달 즉시 아래 쓰기 API를 전부 차단한다 — role/스코핑과 무관하게 30004(상태 전이 불가)를 반환한다.

```text
차단 대상 : 2.4 Update Campaign, 2.6 Approve, 2.7 Reject, 3.1 Issue Codes, 3.2 Retry Code Issuance
차단 안 됨 : 2.2/2.3(조회), 3.3 코드 목록 조회, 4.1 사용 이력 조회 — 종료된 캠페인도 이력 확인은 계속 가능해야 함
```

`status=1`(대기)에서 `status=2`(활성)로 이미 넘어간 캠페인의 상태변경(활성 ↔ 일시중지)은 이 원칙과 무관하게 계속 허용된다 — [2.5](#25-change-campaign-status)의 상태 전이표에 이미 정의된 대로다. 이 절이 새로 막는 것은 오직 `status=4`(종료) 도달 이후의 모든 쓰기 액션이다.

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
- `reward_data` 필수(JSON), 쿠폰서버는 내용을 해석하지 않고 그대로 저장([04_DATABASE_SCHEMA.md](./04_DATABASE_SCHEMA.md) 6장 참고)

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

미존재는 31004, 스코핑 범위 밖(1.2 일반 원칙과 동일)이면 20001.

---

## 2.4 Update Campaign

### Endpoint

```http
PATCH /campaigns/{coupon_campaign_id}
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만)

### Request

```json
{
  "updated_at": "2026-07-20 10:00:00",
  "name": "여름 이벤트 쿠폰(연장)",
  "campaign_end": "2026-09-15 23:59:59"
}
```

`updated_at`은 필수다 — [2.3 Get Campaign](#23-get-campaign)에서 마지막으로 조회했을 때 받은 값을 그대로 되돌려 보낸다(낙관적 동시성 제어용 토큰, 아래 Concurrency 참고). 나머지 필드는 전부 선택(NULL/생략 시 미변경).

### Precondition

`status != 4`(종료)여야 한다 — 종료된 캠페인은 어떤 필드도 수정 불가(1.3 참고). 위반 시 30004.

### Concurrency

`updated_at`이 서버의 현재 값과 다르면(=요청을 만드는 사이 다른 사용자가 이미 수정함) 30005(동시 수정 충돌)를 반환하고 이번 요청은 적용하지 않는다 — `coupon_campaign.updated_at`은 모든 수정 시 자동 갱신되므로 별도 버전 컬럼 없이 이 값 하나로 "그 사이 변경 여부"를 판별한다. 클라이언트는 최신 데이터를 다시 조회한 뒤 재시도해야 한다. 이 검증과 아래 Validation/Business Rules는 서버가 UPDATE 문 하나로 원자적으로 함께 처리한다(조건부 UPDATE, 02_DEV_CONVENTIONS.md 4장) — 즉 "그 사이 아무것도 안 바뀌었는지"와 "수정 내용 자체가 유효한지"를 별도 단계로 나눠 순차 확인하지 않는다.

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

- `updated_at`이 서버의 현재 값과 일치해야 함(불일치 시 30005 — 위 Concurrency 참고)
- `campaign_end > campaign_start`
- `usable_qty <= generated_qty` (아직 발급되지 않은 수량보다 많이 열 수 없음)
- `name` 최대 100자, `use_limit_per_user` 1 이상

### Business Rules

- **수정 시 재승인 — 호출자가 OPERATOR일 때만**: 호출자 `role_code=40`(OPERATOR)이고 수정 직전 `approval_status`가 `3`(승인완료) 또는 `4`(반려)였다면, 수정과 동시에 `2`(승인대기)로 재전환한다 — OPERATOR는 승인권한이 없으므로 이미 승인된 내용을 승인 절차 없이 바꾸는 우회를 막기 위함. `approval_status`가 `1`(승인불요) 또는 이미 `2`(승인대기)였다면 그대로 유지한다
- **승인권한 role(SUPER_ADMIN/DEVELOPER/MANAGER)의 수정은 즉시 적용**: `role_code<=30`이 호출자면 `approval_status`/`status` 변경 없이 수정 내용이 그대로 반영된다 — 이 role들은 자신이 곧 승인권자이므로 수정 행위 자체가 재승인을 동반한다고 보기 때문이다(MANAGER가 OPERATOR 소유 캠페인을 대신 수정하는 경우도 동일 — "대신 수정"이 아니라 승인권자의 판단으로 취급). `approval_status`가 이미 `3`/`4`였어도 그대로 유지한다
- **활성 캠페인 보호(일시중지)**: 위 OPERATOR 재승인 전환이 발생하는 동시에 `status`가 `2`(활성)였다면 `status`도 `3`(일시중지)로 강제 전환한다 — 활성 서비스 중인 캠페인이 미승인 내용으로 계속 노출되는 상황을 막기 위함(재활성화는 재승인 후 [2.5](#25-change-campaign-status)로 관리자가 다시 수행). 승인권한 role의 수정은 위 규칙에 따라 애초에 재승인이 발동하지 않으므로 이 강제 일시중지도 발동하지 않는다 — 유저인입이 진행 중인 활성 캠페인이라도 승인권자의 판단이므로 끊김 없이 즉시 반영된다
- `log_coupon_campaign`에 `action=20`(UPDATE) 스냅샷 기록(OPERATOR의 수정으로 `approval_status`/`status`가 함께 바뀐 경우, 바뀐 이후 값 기준으로 1행만 기록 — 별도 STATUS_CHANGE 행을 추가로 남기지 않음)

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

`approval_status=2`가 아니면 30004. `status=4`(종료)면 `approval_status`와 무관하게 30004(1.3 참고 — `status=1`에서 승인 없이 바로 종료된 캠페인도 이후 승인 대상에서 제외됨).

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

`approval_status=2`가 아니면 30004. `status=4`(종료)면 `approval_status`와 무관하게 30004(1.3 참고).

### Business Rules

- `approved_by`/`approved_at`/`reject_reason` 기록(승인과 동일한 스냅샷 컬럼 사용 — [04_DATABASE_SCHEMA.md](./04_DATABASE_SCHEMA.md) 6장 참고)
- 반려 후 재제출하려면 [2.4 Update Campaign](#24-update-campaign)으로 수정 — 수정 즉시 `approval_status`가 `2`(승인대기)로 재전환되어 자동으로 재상신된다(별도 "재제출 API" 없음)
- `log_coupon_campaign`에 `action=50`(REJECT) 스냅샷 기록

### Response

반려 후 최종 데이터 반환

---

# 3. Coupon Code Issuance APIs

흐름/재시도 알고리즘과 "왜 FIXED는 캠페인당 코드 1건뿐인가" 등 설계 근거는 [05_COUPON_ISSUANCE_SCENARIO.md](./05_COUPON_ISSUANCE_SCENARIO.md) 2장 참고. 본 장은 상세 요청/응답 스키마만 다룬다.

## 3.1 Issue Codes

### Endpoint

```http
POST /campaigns/{coupon_campaign_id}/codes
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만) — **`approval_status`와 무관하게 호출 가능**(코드 발급은 승인 워크플로우와 독립적, [05_COUPON_ISSUANCE_SCENARIO.md](./05_COUPON_ISSUANCE_SCENARIO.md) 1장 참고)

### Precondition

`generation_status=1`(대기)일 때만 허용(캠페인당 1회) — 아니면 30004. `status=4`(종료)면 `generation_status`와 무관하게 30004(1.3 참고).

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

- **RANDOM**: 호출 즉시 `generation_status=2`(진행중)로 전환 후 `202 Accepted` 응답, 백그라운드로 `requested_qty`만큼 대량 생성. 코드값 충돌은 즉시 재생성, DB 일시 오류는 backoff+jitter 재시도, 재시도 소진 시 `generation_status=4`(실패) + `generation_error` 기록([05_COUPON_ISSUANCE_SCENARIO.md](./05_COUPON_ISSUANCE_SCENARIO.md) 2.2 참고). 전량 생성 완료 시 `generation_status=3`(완료)
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

`generation_status=4`(실패)일 때만 허용 — RANDOM 전용(FIXED는 이 상태에 도달하지 않으므로 사실상 호출 대상이 아님). 아니면 30004. `status=4`(종료)면 `generation_status`와 무관하게 30004(1.3 참고).

### Business Rules

- 조건부 UPDATE로 원자성 확보(관리자의 종료 처리와 재시도 요청이 동시에 들어오는 경우까지 WHERE절에서 함께 막는다):
  ```sql
  UPDATE coupon_campaign SET generation_status=2
  WHERE coupon_campaign_id=? AND generation_status=4 AND status != 4
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

페이지네이션 응답 형식([08_API_COMMON.md](./08_API_COMMON.md) 2장 참고). FIXED는 항상 최대 1건.

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

# 4. Coupon Usage History (Admin Console)

관리 콘솔(JWT 인증)에서 캠페인별 쿠폰 사용 이력을 조회하는 API. [18_COUPON_USAGE_API.md](./18_COUPON_USAGE_API.md)의 `GET /coupons/unconfirmed`는 게임서버가 S2S(API Key)로 호출하는 별개의 엔드포인트이며, 이 절의 API와는 인증 주체·용도가 다르다(그쪽은 게임서버의 미지급 재처리용, 이쪽은 운영자의 조회/문의대응용).

## 4.1 Get Coupon Usage List

### Endpoint

```http
GET /campaigns/{coupon_campaign_id}/usages
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만) — 조회 전용이라 승인 여부(`approval_status`)와 무관하게 캠페인 접근 권한만 있으면 볼 수 있다(2.3 Get Campaign과 동일한 권한 범위)

### Query Parameters

| Name          | Required | Description |
|---------------|----------|--------------|
| game_user_id  | N        | 특정 유저로 필터(운영 문의 대응 시 사용) |
| confirmed     | N        | `0`(미컨슘만) / `1`(컨펌완료만), 생략 시 전체 |
| page          | Y        | |
| page_size     | Y        | 20/30/50/100 중 선택. 기본 20 |

### Response

페이지네이션 응답 형식([08_API_COMMON.md](./08_API_COMMON.md) 2장 참고).

```json
{
  "result": 0,
  "data": {
    "page": 1,
    "page_size": 20,
    "total_count": 3,
    "items": [
      {
        "coupon_code_usage_id": 9000,
        "code_value": "23A4-B7C9-DEF2",
        "game_user_id": "player_1001",
        "confirmed_at": "2026-07-18 10:00:05",
        "created_at": "2026-07-18 10:00:00"
      }
    ]
  }
}
```

`confirmed_at`이 `null`이면 미컨슘 건이다. `reward_data`는 캠페인 상세(2.3)에서 이미 확인 가능해 행마다 반복하지 않는다.

### Errors

미존재는 31004, 스코핑 범위 밖(1.2 일반 원칙과 동일)이면 20001.

---

# 5. 관련 문서

- 캠페인/코드 발급 흐름 근거: [05_COUPON_ISSUANCE_SCENARIO.md](./05_COUPON_ISSUANCE_SCENARIO.md)
- 쿠폰 사용(reserve/confirm) 상세 API: [18_COUPON_USAGE_API.md](./18_COUPON_USAGE_API.md)
- 테이블 DDL: `database/tables/coupon_campaign.sql`, `coupon_code.sql`, `coupon_code_usage.sql`, `log_coupon_campaign.sql`
- 공통 응답/에러코드: [08_API_COMMON.md](./08_API_COMMON.md)
