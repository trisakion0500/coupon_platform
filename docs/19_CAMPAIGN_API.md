# 19_CAMPAIGN_API.md

# Coupon Platform REST API Specification — Campaign / Coupon Code

---

# 1. Common Rules

## 1.1 Response Format

공통 응답 포맷/에러코드는 [10_API_COMMON.md](./10_API_COMMON.md)를 따른다.

## 1.2 Role Definition

Role Code 표 자체는 [12_COMPANY_API.md](./12_COMPANY_API.md) 1.2를 따른다. 쿠폰 도메인(캠페인/코드) 컨트롤 권한 세부는 그동안 "쿠폰 도메인 설계 시점에 정의"로 미뤄뒀던 부분이며, 본 절에서 최초로 확정한다.

### SUPER_ADMIN

- 모든 프로젝트의 캠페인/코드 전체 컨트롤(생성/수정/상태변경/코드발급/승인/반려) 가능

### DEVELOPER

- `user_role`에 실제로 **활성 배정된 `project_id`**의 캠페인/코드만 조회/컨트롤 가능 — [13_PROJECT_API.md](./13_PROJECT_API.md) 2.5 Rotate Project API Secret과 동일한 프로젝트 단위 스코핑 원칙. DEVELOPER의 프로젝트 관리메뉴 조회(2.2 Get Project List 등)는 회사 단위로 넓지만, 그건 "조회"에 한정된 예외이고 실제 컨트롤(쓰기) 액션은 배정된 프로젝트로 좁힌다는 게 기존 선례 — 쿠폰 도메인은 생성/수정/승인 등 컨트롤(쓰기) 중심이라 이 선례를 따른다
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
차단 대상 : 2.4 Update Campaign, 2.6 Approve, 2.7 Reject, 3.1 Issue Codes, 3.2 Retry Code Issuance, 3.4 Abort Code Generation
차단 안 됨 : 2.2/2.3(조회), 3.3 코드 목록 조회, 4.1 사용 이력 조회, 4.2 캠페인 변경 이력 조회, 4.3 쿠폰 사용 로그 조회 — 종료된 캠페인도 이력/로그 확인은 계속 가능해야 함
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
- `requested_qty` 필수, `1` 이상 — **RANDOM/FIXED 공통**. RANDOM은 실제 발급할 코드 개수, FIXED는 (코드 자체는 항상 1건이지만) 그 1건이 지원할 **총 사용가능 횟수**를 의미한다(2026-07-22, 아래 Business Rules 참고)
- `use_limit_per_user` 1 이상(기본 1)
- `reward_data` 필수(JSON), 쿠폰서버는 내용을 해석하지 않고 그대로 저장([06_DATABASE_SCHEMA.md](./06_DATABASE_SCHEMA.md) 6장 참고)

### Business Rules

- **`approval_status` 자동 결정**: 호출자 `role_code <= 30`(SUPER_ADMIN/DEVELOPER/MANAGER)이면 `1`(승인불요), `role_code = 40`(OPERATOR)이면 `2`(승인대기)
- **`code_type=2`(FIXED)도 `requested_qty`를 호출자가 직접 지정한다** — FIXED는 여전히 캠페인당 코드 1건만 존재하지만(3.1 참고), `requested_qty`/`generated_qty`는 "코드 개수"가 아니라 "그 1건을 서로 다른 유저가 각자 소모할 수 있는 총 횟수"를 의미한다. 처음엔 FIXED의 `requested_qty`를 서버가 항상 `1`로 강제했으나, 그러면 [2.4 Update Campaign](#24-update-campaign)의 `usable_qty<=generated_qty` 검증 때문에 FIXED 캠페인이 전체 통틀어 딱 1번만 소모 가능해져 [20_COUPON_USAGE_API.md](./20_COUPON_USAGE_API.md)가 전제하는 "서로 다른 유저의 독립적 reserve"가 막히는 문제가 실사용 테스트에서 발견되어(2026-07-22) 제거했다
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
    "updated_at": "2026-07-17 10:00:00",
    "edit_count": 0
  }
}
```

`edit_count`는 [2.4 Update Campaign](#24-update-campaign) 낙관적 동시성 제어용 토큰이다 — 이 캠페인을 조회한 화면에서 수정 요청을 만들 때 여기서 받은 값을 그대로 되돌려 보낸다.

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

페이지네이션 응답 형식([10_API_COMMON.md](./10_API_COMMON.md) 2장 참고).

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
  "edit_count": 3,
  "name": "여름 이벤트 쿠폰(연장)",
  "campaign_end": "2026-09-15 23:59:59"
}
```

`edit_count`는 필수다 — [2.3 Get Campaign](#23-get-campaign)에서 마지막으로 조회했을 때 받은 값을 그대로 되돌려 보낸다(낙관적 동시성 제어용 토큰, 아래 Concurrency 참고). 나머지 필드는 전부 선택(NULL/생략 시 미변경).

### Precondition

`status != 4`(종료)여야 한다 — 종료된 캠페인은 어떤 필드도 수정 불가(1.3 참고). 위반 시 30004.

### Concurrency

`edit_count`가 서버의 현재 값과 다르면(=요청을 만드는 사이 다른 사용자가 이미 수정함) 30005(동시 수정 충돌)를 반환하고 이번 요청은 적용하지 않는다. 클라이언트는 최신 데이터를 다시 조회한 뒤 재시도해야 한다. 이 검증과 아래 Validation/Business Rules는 서버가 UPDATE 문 하나로 원자적으로 함께 처리한다(조건부 UPDATE, 04_DEV_CONVENTIONS.md 4장) — 즉 "그 사이 아무것도 안 바뀌었는지"와 "수정 내용 자체가 유효한지"를 별도 단계로 나눠 순차 확인하지 않는다.

`coupon_campaign.edit_count`는 이 캠페인 행을 바꾸는 모든 쓰기 API(2.4 Update, 2.5 Change Status, 2.6 Approve, 2.7 Reject)가 성공할 때마다 1씩 증가하는 전용 정수 카운터다(테이블 DDL 헤더 주석 참고) — 처음엔 자동 갱신 컬럼인 `updated_at`을 그대로 재사용했으나, `DATETIME`이 초 단위까지만 기록돼 같은 초 안에 두 수정(예: 승인 처리 직후 같은 초에 들어온 수정)이 겹치면 값이 안 바뀐 것처럼 보여 충돌을 놓치는 사례가 실제로 재현되어, 타이밍에 전혀 의존하지 않는 정수 카운터로 교체했다.

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

- `edit_count`가 서버의 현재 값과 일치해야 함(불일치 시 30005 — 위 Concurrency 참고)
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
  "edit_count": 3,
  "status": 2
}
```

`edit_count`는 필수다 — 마지막으로 조회했을 때 받은 값을 그대로 되돌려 보낸다(낙관적 동시성 제어용 토큰, 아래 Concurrency 참고).

### Concurrency

[2.4 Update Campaign의 Concurrency](#24-update-campaign)와 동일한 원칙 — `edit_count`가 서버의 현재 값과 다르면 30005(동시 수정 충돌)를 반환하고 상태 전이를 적용하지 않는다. 수정/승인/반려/상태변경은 어떤 순서로도 섞여 들어올 수 있어(예: 승인자가 화면을 보고 있는 사이 다른 관리자가 먼저 상태를 바꾼 경우), 이 SP도 조건부 UPDATE의 WHERE절에 `edit_count=i_edit_count`를 포함해 원자적으로 검증한다.

### Allowed State Transition

| From        | To          | 추가 조건                                                   |
| ----------- | ----------- | ------------------------------------------------------------ |
| 1(대기)     | 2(활성)     | `approval_status IN (1,3)` AND `campaign_end > NOW()` 필요    |
| 1(대기)     | 4(종료)     | 활성화 전 취소                                               |
| 2(활성)     | 3(일시중지) | -                                                             |
| 2(활성)     | 4(종료)     | -                                                             |
| 3(일시중지) | 2(활성)     | `approval_status IN (1,3)` AND `campaign_end > NOW()` 필요(재확인) |
| 3(일시중지) | 4(종료)     | -                                                             |

`4`(종료)는 최종 상태이며 이후 전이가 없다. 표에 없는 조합(예: `1→3`)과 승인 조건 미충족은 30004(상태 전이 불가)를 반환한다.

**`campaign_end > NOW()` 조건(2026-07-25 추가)**: 활성화(`1→2`)/재활성화(`3→2`) 전이에만 적용된다 — 이미 사용기간이 지난 캠페인이 "활성" 상태로 진입하는 것 자체를 막기 위함이다. 이 조건이 없으면 활성화 직후부터 `status=2`(활성)로 보이지만 reserve는 자체 시간 조건(`coupon_campaign.sql` 동시성 절 참고)에 걸려 즉시 거부되는, 겉보기와 실제가 어긋나는 상태에 바로 진입할 수 있었다. **이미 활성 상태인 캠페인이 그 상태로 있는 도중 사용기간이 자연스럽게 지나는 것은 이 조건과 무관한 별개 문제**이며(진입을 막는 게 아니라 이미 들어간 뒤 시간이 흐르는 경우라 별도 검토 대상), 수정([2.4](#24-update-campaign))·승인·반려·코드발급([3장](#3-coupon-code-issuance-apis))은 사용기간 만료와 무관하게 계속 허용한다 — 특히 수정으로 `campaign_end`를 연장해 되살리는 경로를 막지 않기 위해 이 전이(2.5)에만 좁게 적용했다.

### Business Rules

- 조건부 UPDATE로 원자성 확보:
  ```sql
  UPDATE coupon_campaign SET status=?, edit_count=edit_count+1
  WHERE coupon_campaign_id=? AND edit_count=? AND status=? [AND approval_status IN (1,3) AND campaign_end > NOW()]
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

### Request

```json
{
  "edit_count": 3
}
```

`edit_count`는 필수다 — 승인자가 검토 화면에서 마지막으로 조회했을 때 받은 값을 그대로 되돌려 보낸다(낙관적 동시성 제어용 토큰, 아래 Concurrency 참고).

### Concurrency

[2.4 Update Campaign의 Concurrency](#24-update-campaign)와 동일한 원칙 — `edit_count`가 서버의 현재 값과 다르면(=승인자가 검토한 이후 내용이 바뀌었다는 뜻) 30005(동시 수정 충돌)를 반환하고 승인을 적용하지 않는다. 승인 시점의 `approval_status=2` 체크만으로는 "이미 승인된 건 재승인 못 함"만 막을 뿐 "승인자가 검토한 것과 다른 내용을 승인해버리는 것"은 막지 못하므로, 조건부 UPDATE의 WHERE절에 `edit_count=i_edit_count`를 함께 건다.

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
  "edit_count": 3,
  "reject_reason": "보상 아이템 ID 확인 필요"
}
```

`edit_count`는 필수다 — 마지막으로 조회했을 때 받은 값을 그대로 되돌려 보낸다(낙관적 동시성 제어용 토큰, 아래 Concurrency 참고).

### Validation

- `reject_reason` 필수, 최대 500자

### Concurrency

[2.6 Approve Campaign의 Concurrency](#26-approve-campaign)와 동일한 원칙 — `edit_count`가 서버의 현재 값과 다르면 30005(동시 수정 충돌)를 반환하고 반려를 적용하지 않는다.

### State Transition

```text
2(승인대기) → 4(반려)
```

`approval_status=2`가 아니면 30004. `status=4`(종료)면 `approval_status`와 무관하게 30004(1.3 참고).

### Business Rules

- `approved_by`/`approved_at`/`reject_reason` 기록(승인과 동일한 스냅샷 컬럼 사용 — [06_DATABASE_SCHEMA.md](./06_DATABASE_SCHEMA.md) 6장 참고)
- 반려 후 재제출하려면 [2.4 Update Campaign](#24-update-campaign)으로 수정 — 수정 즉시 `approval_status`가 `2`(승인대기)로 재전환되어 자동으로 재상신된다(별도 "재제출 API" 없음)
- `log_coupon_campaign`에 `action=50`(REJECT) 스냅샷 기록

### Response

반려 후 최종 데이터 반환

---

# 3. Coupon Code Issuance APIs

흐름/재시도 알고리즘과 "왜 FIXED는 캠페인당 코드 1건뿐인가" 등 설계 근거는 [07_COUPON_ISSUANCE_SCENARIO.md](./07_COUPON_ISSUANCE_SCENARIO.md) 2장 참고. 본 장은 상세 요청/응답 스키마만 다룬다.

## 3.1 Issue Codes

### Endpoint

```http
POST /campaigns/{coupon_campaign_id}/codes
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만) — **`approval_status`와 무관하게 호출 가능**(코드 발급은 승인 워크플로우와 독립적, [07_COUPON_ISSUANCE_SCENARIO.md](./07_COUPON_ISSUANCE_SCENARIO.md) 1장 참고)

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

- **RANDOM**: 호출 즉시 `generation_status=2`(진행중)로 전환 후 `202 Accepted` 응답, 백그라운드로 `requested_qty`만큼 대량 생성. 코드값 충돌은 즉시 재생성, DB 일시 오류는 backoff+jitter 재시도, 재시도 소진 시 `generation_status=4`(실패) + `generation_error` 기록([07_COUPON_ISSUANCE_SCENARIO.md](./07_COUPON_ISSUANCE_SCENARIO.md) 2.2 참고). 전량 생성 완료 시 `generation_status=3`(완료)
- **FIXED**: 동기 처리, 성공 시 `coupon_code` 1행 생성 + `generated_qty=requested_qty`(캠페인 생성 시 지정한 총 사용가능 횟수 — 코드 행은 항상 1건이지만 이 값은 코드 개수가 아니다, 2.1 Business Rules 참고), `generation_status=3`(완료)로 즉시 `200 OK` 응답. FIXED는 `generation_status=4`(실패) 상태에 도달하지 않는다(재시도 인프라 대상이 아님 — 실패 시 그냈로 재요청)

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
    "generated_qty": 100,
    "coupon_code": {
      "coupon_code_id": 5000,
      "code_value": "SUMMER2024",
      "status": 1
    }
  }
}
```

`generated_qty`는 캠페인 생성 시 지정한 `requested_qty`와 동일한 값이다(위 예시는 `requested_qty=100`으로 생성한 캠페인) — `coupon_code` 행은 위와 같이 항상 1건뿐이지만, 이 값은 "이 코드를 서로 다른 유저가 각자 소모할 수 있는 총 횟수"를 의미한다.

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

페이지네이션 응답 형식([10_API_COMMON.md](./10_API_COMMON.md) 2장 참고). FIXED는 항상 최대 1건.

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

## 3.4 Abort Code Generation

### Endpoint

```http
POST /campaigns/{coupon_campaign_id}/codes/abort
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER (스코핑 내 `project_id`만) — **OPERATOR는 불가**. 승인/반려(2.6/2.7)와 동일한 급의 판단(시스템이 자동으로 못 정하는 걸 사람이 강제로 결정)이라 그 권한 범위를 그대로 따른다.

### 배경

서버 프로세스가 RANDOM 코드 대량생성 백그라운드 작업 도중 재시작/크래시되면(작업이 순수 인메모리 상태라 재시작 시 완전히 유실됨) 캠페인이 `generation_status=2`(진행중)에 영구히 멈출 수 있다 — [3.1 Issue Codes](#31-issue-codes)는 `generation_status=1`일 때만, [3.2 Retry Code Issuance](#32-retry-code-issuance)는 `generation_status=4`일 때만 허용하므로 둘 중 어느 것으로도 복구할 수 없다(07_COUPON_ISSUANCE_SCENARIO.md 2.4 참고). 이 API는 관리자가 "이 job은 멈췄다"고 수동으로 판단해 정체를 풀 수 있게 한다.

### Precondition

- `generation_status=2`이고, `updated_at`이 서버가 계산한 임계값(초) 이상 갱신되지 않았을 때만 허용한다 — **호출한다고 무조건 되는 게 아니다.** `coupon_campaign.updated_at`은 `SP_CAMPAIGN_CODE_GENERATE_ONE`이 코드를 하나 만들 때마다 자동 갱신되므로, 최근에 실제로 진행된 흔적이 있으면(=아직 살아있을 가능성이 높으면) 30004로 거부한다. 임계값은 `CODE_GENERATION_MAX_DB_RETRIES`/`CODE_GENERATION_RETRY_BASE_DELAY_MS`/`CODE_GENERATION_ABORT_STALE_SAFETY_MULTIPLIER`(02_TECH_STACK.md)로 서버가 계산한다 — 정상적으로 살아있는 루프가 DB 일시 오류 재시도로 만들 수 있는 이론상 최대 무진행 구간보다 충분히 크게 잡아, 실제로 살아있는 job을 성급하게 끊지 않도록 한다.
- `status=4`(종료)면 30004(1.3 참고).
- `generation_status`가 2가 아니면(이미 완료/실패/대기) 30004.

### Business Rules

- **RANDOM**(`code_type=1`): `generation_status=4`(실패)로 전환하고 `generation_error`에 사유를 남긴다. 이후 관리자가 [3.2 Retry Code Issuance](#32-retry-code-issuance)를 그대로 호출하면 이미 만든 `generated_qty`부터 이어서 생성된다.
- **FIXED**(`code_type=2`): `generation_status=1`(대기)로 전환한다. FIXED는 성공 아니면 아무것도 만들어지지 않는(all-or-nothing) 동기 처리라 "부분 진행" 개념이 없다 — [3.1 Issue Codes](#31-issue-codes)로 처음부터 다시 발급하면 된다.
- `edit_count`/`log_coupon_campaign` 둘 다 대상이 아니다 — 3.1/3.2와 동일한 축(코드 발급은 별개 흐름).

### Response

```json
{
  "result": 0,
  "data": {
    "coupon_campaign_id": 100,
    "generation_status": 4
  }
}
```

### Errors

미존재는 31004, 스코핑 범위 밖(1.2 일반 원칙과 동일)이면 20001, 전제조건 미충족(진행중 아님/아직 stale 기준 미달/캠페인 종료)이면 30004.

---

# 4. Read & Log APIs (Admin Console)

관리 콘솔(JWT 인증)에서 캠페인/코드/사용 도메인의 이력·로그를 조회하는 API. [20_COUPON_USAGE_API.md](./20_COUPON_USAGE_API.md)의 `POST /coupons/unconfirmed`는 게임서버가 S2S(API Key)로 호출하는 별개의 엔드포인트이며, 이 절의 API와는 인증 주체·용도가 다르다(그쪽은 게임서버의 미지급 재처리용, 이쪽은 운영자의 조회/문의대응용) — `log_coupon_use` 조회(4.3)도 원본 시도 기록은 게임서버 S2S 호출로 쌓이지만, 그걸 사람이 들여다보는 창구는 이 절의 관리 콘솔 API다.

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

### Sorting

```sql
ORDER BY created_at DESC, coupon_code_usage_id DESC
```

`created_at`(초 단위 정밀도) 단독 정렬은 같은 초 안에 여러 건이 쌓이면 순서가 흔들릴 수 있어(`SP_LOG_AUDIT_LIST`에서 실제로 재현됐던 문제), AUTO_INCREMENT PK인 `coupon_code_usage_id`를 2차 정렬 키로 추가했다(2026-07-23, 4.2/4.3과 동일한 패턴).

### Response

페이지네이션 응답 형식([10_API_COMMON.md](./10_API_COMMON.md) 2장 참고).

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

## 4.2 Get Campaign Change Log

### Endpoint

```http
GET /campaigns/{coupon_campaign_id}/logs
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만) — 4.1과 동일한 권한 범위, 조회 전용이라 승인 여부(`approval_status`)와 무관

### Query Parameters

| Name      | Required | Description |
|-----------|----------|--------------|
| action    | N        | `10:CREATE`/`20:UPDATE`/`30:STATUS_CHANGE`/`40:APPROVE`/`50:REJECT` 필터 |
| page      | Y        | |
| page_size | Y        | 20/30/50/100 중 선택. 기본 20 |

### Sorting

```sql
ORDER BY created_at DESC, idx DESC
```

### Response

페이지네이션 응답 형식([10_API_COMMON.md](./10_API_COMMON.md) 2장 참고). `log_coupon_campaign`([06_DATABASE_SCHEMA.md](./06_DATABASE_SCHEMA.md) 10장) 컬럼을 그대로 반환한다 — `log_audit`의 `before_json`/`after_json` 방식이 아니라 그 시점 `coupon_campaign` 전체 스냅샷 한 장씩이므로, 백엔드는 목록만 제공하고 "무엇이 바뀌었는지"는 프론트엔드가 인접한 두 로그 행(시간순 바로 앞/뒤)을 비교해 표시한다 — 가장 오래된 행(`action=10 CREATE`)은 비교 대상이 없으므로 생성 시점 상태 그대로 보여준다.

```json
{
  "result": 0,
  "data": {
    "page": 1,
    "page_size": 20,
    "total_count": 3,
    "items": [
      {
        "idx": 2001,
        "action": 40,
        "coupon_campaign_id": 100,
        "project_id": 10,
        "name": "여름 이벤트",
        "campaign_start": "2026-07-01 00:00:00",
        "campaign_end": "2026-07-31 23:59:59",
        "code_type": 1,
        "use_hyphen": 1,
        "requested_qty": 100,
        "generated_qty": 100,
        "usable_qty": 100,
        "used_qty": 3,
        "use_limit_per_user": 1,
        "status": 2,
        "approval_status": 3,
        "approved_by": 5,
        "approved_at": "2026-07-18 09:00:00",
        "reject_reason": null,
        "reward_data": { "item_id": 5001, "qty": 3 },
        "created_by": 5,
        "created_by_name": "Manager",
        "created_at": "2026-07-18 09:00:00"
      }
    ]
  }
}
```

### Errors

미존재는 31004, 스코핑 범위 밖(1.2 일반 원칙과 동일)이면 20001.

---

## 4.3 Get Coupon Use Log List

### Endpoint

```http
GET /coupon-use-logs
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만) — 1.2와 동일한 프로젝트 단위 스코핑. `log_audit`(시스템관리자 영역)과 달리 이 로그는 "유저 영역"([06_DATABASE_SCHEMA.md](./06_DATABASE_SCHEMA.md) 11장)이라 캠페인 도메인과 동일하게 전 역할이 대상

### Query Parameters

| Name               | Required | Description |
|--------------------|----------|--------------|
| project_id         | Y        | 스코핑 기준(1.2와 동일 — 회사 단위 조회 예외 없음) |
| coupon_campaign_id | N        | 특정 캠페인으로 좁힘. 지정하지 않으면 코드 자체가 존재하지 않는 시도(브루트포스 탐지 대상, `coupon_campaign_id` NULL)까지 포함해 프로젝트 전체를 반환 |
| game_user_id       | N        | 특정 유저로 필터(운영 문의 대응) |
| code_value         | N        | 특정 코드 문자열로 필터(동일 코드 반복 시도 확인) |
| action             | N        | `10:RESERVE`/`20:CONFIRM` 필터 |
| result_type        | N        | `log_coupon_use.result_type` 필터([06_DATABASE_SCHEMA.md](./06_DATABASE_SCHEMA.md) 11장) |
| from_created_at    | N        | 조회 시작일시 |
| to_created_at      | N        | 조회 종료일시 |
| page               | Y        | |
| page_size          | Y        | 20/30/50/100 중 선택. 기본 20 |

### Sorting

```sql
ORDER BY created_at DESC, idx DESC
```

### Response

페이지네이션 응답 형식([10_API_COMMON.md](./10_API_COMMON.md) 2장 참고).

```json
{
  "result": 0,
  "data": {
    "page": 1,
    "page_size": 20,
    "total_count": 2,
    "items": [
      {
        "idx": 5001,
        "action": 10,
        "project_id": 10,
        "coupon_campaign_id": 100,
        "campaign_name": "여름 이벤트",
        "code_value": "23A4-B7C9-DEF2",
        "game_user_id": "player_1001",
        "result_type": 0,
        "caller_ip": "203.0.113.10",
        "created_at": "2026-07-18 10:00:00"
      },
      {
        "idx": 5000,
        "action": 10,
        "project_id": 10,
        "coupon_campaign_id": null,
        "campaign_name": null,
        "code_value": "ZZZZ-ZZZZ-ZZZZ",
        "game_user_id": "player_1001",
        "result_type": 10,
        "caller_ip": "203.0.113.10",
        "created_at": "2026-07-18 09:59:50"
      }
    ]
  }
}
```

`campaign_name`은 `log_coupon_use` 자체 컬럼이 아니다 — `coupon_campaign_id`가 있는 행에 한해 메인 DB(`coupon_campaign`)에서 배치 조회해 응답 조립 시 붙인다(로그 DB는 메인 DB와 물리 분리라 SQL JOIN 불가, [04_DEV_CONVENTIONS.md](./04_DEV_CONVENTIONS.md) 1장). `coupon_campaign_id`가 NULL인 행(코드 자체가 존재하지 않는 시도)은 `campaign_name`도 NULL이다. `caller_ip`(2026-07-23 추가)는 호출한 게임서버의 IP — 인증 목적이 아니라 이상징후 탐지·장애조사 보조용이며, `NULL`일 수 있다([06_DATABASE_SCHEMA.md](./06_DATABASE_SCHEMA.md) 11장 참고).

### Errors

`project_id` 누락은 30001. 스코핑 범위 밖(1.2 일반 원칙과 동일, 존재하지 않는 `project_id` 포함 — 2.2 `SP_CAMPAIGN_LIST`와 동일하게 SUPER_ADMIN은 별도 존재확인 없이 통과하고 빈 목록을 반환할 수 있다)이면 20001.

---

# 5. 시스템 자동 처리 (API 호출 없이 발생하는 상태변경)

## 5.1 사용기간 만료 자동 종료

API 엔드포인트가 아니라 서버 배치(`CampaignExpiryService`, `CAMPAIGN_EXPIRY_CRON` 스케줄, 기본 5분 주기)가 주기적으로 트리거하는 시스템 상태변경이다(2026-07-25 추가).

### 대상

```text
status = 2(활성) AND approval_status IN (1, 3)(승인불요/승인완료) AND campaign_end <= 서버 시각(NOW())
```

`status = 1`(대기)인 캠페인은 대상이 아니다 — 관리자가 나중에 쓰려고 일부러 활성화하지 않고 대기 상태로 남겨둔 캠페인까지 자동으로 건드리지 않기 위함이다. `approval_status IN (1,3)` 조건은 `status=2` 도달 시점에 이미 보장되는 불변조건([2.5](#25-change-campaign-status) 참고)이라 이론상 항상 참이지만, 호출자 조건을 그대로 안 믿는 이 문서의 일반 원칙과 같은 결로 방어적으로 명시한다.

### 동작

- `status`만 `4`(종료)로 전환한다 — `approval_status`/`generation_status`/`reject_reason` 등 다른 축은 건드리지 않는다(수동 종료와 동일 원칙)
- `updated_by`는 `NULL`로 남긴다. `log_coupon_campaign`에는 `action=30`(STATUS_CHANGE)로 기록하되, 이 로그 테이블의 행위자 컬럼(`created_by`)은 `NOT NULL`이라 사람이 아닌 배치가 한 액션임을 나타내는 sentinel(`created_by=0`/`created_by_name='SYSTEM'`)을 채운다([04_DEV_CONVENTIONS.md](./04_DEV_CONVENTIONS.md) 4.2) — 캠페인 변경이력(4.2 API) 화면에 "작업자: SYSTEM"으로 그대로 노출된다
- `edit_count`는 다른 상태변경 SP와 동일하게 `+1`된다 — 이 시점에 관리자가 들고 있던 `edit_count`로 수정/승인/반려/상태변경을 시도하면 정확히 30005(동시 수정 충돌)로 거부되어, "이미 자동 종료됐다"는 사실을 자연스럽게 알아챌 수 있다

### 이 시점 이후엔 되돌릴 수 없음

`status=4`(종료)에 도달하면 [1.3](#13-종료된-캠페인status4-잠금-원칙)에 따라 이 캠페인의 모든 쓰기(수정으로 `campaign_end` 연장 포함)가 영구히 차단된다. 즉 관리자의 기간 연장 PATCH와 이 배치가 거의 동시에 경합하는 경우, 배치가 이기면 그 캠페인은 되살릴 방법이 없고 새 캠페인을 생성해야 한다 — "이미 만료된 걸 계속 수정 가능하게 두는 것"보다 "한번 종료되면 예외 없이 잠근다"는 원칙을 우선한 결과다(2026-07-25 논의).

### 다른 메커니즘과의 관계

- **reserve API에는 영향 없음** — reserve는 이미 자체 시간조건(`NOW() BETWEEN campaign_start AND campaign_end`)으로 막혀 있어, 이 배치가 돌기 전이든 후든 만료된 캠페인의 reserve 성공 여부는 달라지지 않는다. 이 배치는 순수하게 화면 표시(상태 라벨)를 실제와 맞추는 목적이다
- **RANDOM 백그라운드 코드생성과의 레이스** — 이 배치가 캠페인을 종료시키는 순간에도 [07_COUPON_ISSUANCE_SCENARIO.md](./07_COUPON_ISSUANCE_SCENARIO.md) 2.5의 기존 `status<>4` 가드가 그대로 적용되어 새로 손볼 부분이 없다

---

# 6. 관련 문서

- 캠페인/코드 발급 흐름 근거: [07_COUPON_ISSUANCE_SCENARIO.md](./07_COUPON_ISSUANCE_SCENARIO.md)
- 쿠폰 사용(reserve/confirm) 상세 API: [20_COUPON_USAGE_API.md](./20_COUPON_USAGE_API.md)
- 테이블 DDL: `database/tables/coupon_campaign.sql`, `coupon_code.sql`, `coupon_code_usage.sql`, `database_log/tables/log_coupon_campaign.sql`, `log_coupon_use.sql`
- 공통 응답/에러코드: [10_API_COMMON.md](./10_API_COMMON.md)
