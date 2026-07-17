# 08_PROJECT_API.md

# Coupon Platform REST API Specification — Project

---

# 1. Common Rules

공통 응답 포맷/에러코드는 [05_API_COMMON.md](./05_API_COMMON.md)를 따른다. Role 정의는 [07_COMPANY_API.md](./07_COMPANY_API.md) 1.2를 따른다.

---

# 2. Project APIs

## 2.1 Create Project

### Endpoint

```http
POST /projects
```

### Permission

- SUPER_ADMIN

### Request

```json
{
  "company_id": 1,
  "project_code": "GAB_RPG",
  "project_name": "RPG Project",
  "description": "MMORPG 쿠폰 발급 프로젝트"
}
```

### Validation

- `company_id` 존재
- `project_code` 필수, 동일 `company_id` 내 중복 불가, 영문/숫자/`_`/`.`/`-`만 허용, 최대 20자
- `project_name` 필수, 최대 100자
- `description` 최대 1000자

### Business Rules

- 생성 시 `api_key`/`api_secret`을 서버가 즉시 발급한다(`project.api_key`/`api_secret_hash`가 NOT NULL 컬럼이라 발급 없이는 프로젝트를 만들 수 없음 — [03_DATABASE_SCHEMA.md](./03_DATABASE_SCHEMA.md) 2장 참고)
- `api_secret` 평문은 이 응답에만 1회 노출되며, 이후 어떤 조회 API도 평문/해시를 반환하지 않는다
- `secret_rotated_at`은 생성 시 `NULL`(최초 발급 후 미변경 상태)

### Response

```json
{
  "result": 0,
  "data": {
    "project_id": 10,
    "company_id": 1,
    "project_code": "GAB_RPG",
    "project_name": "RPG Project",
    "description": "MMORPG 쿠폰 발급 프로젝트",
    "api_key": "a1b2c3...(64자 hex)",
    "api_secret": "s3cr3t...(평문, 이 응답에만 1회 노출)",
    "status": 1,
    "created_at": "2026-07-16 10:00:00",
    "updated_at": "2026-07-16 10:00:00"
  }
}
```

---

## 2.2 Get Project List

### Endpoint

```http
GET /projects
```

### Permission

- SUPER_ADMIN
- DEVELOPER

### Query Parameters

| Name       | Required | Description                |
| ---------- | -------- | -------------------------- |
| company_id | N        |                             |
| status     | N        |                             |
| page       | Y        |                             |
| page_size  | Y        | 20/30/50/100 중 선택. 기본 20 |

### Sorting

```sql
ORDER BY status DESC,
         project_name ASC
```

### Business Rules

- SUPER_ADMIN: 전체 프로젝트 목록 반환
- DEVELOPER: 본인 소속 `company_id`의 프로젝트만 반환

### Response

페이지네이션 응답 형식([05_API_COMMON.md](./05_API_COMMON.md) 2장 참고). `api_secret_hash`/평문 `api_secret`은 포함하지 않는다. `api_key`는 식별자 성격이라 그대로 노출한다.

```json
{
  "result": 0,
  "data": {
    "page": 1,
    "page_size": 20,
    "total_count": 100,
    "items": [
      {
        "project_id": 10,
        "company_id": 1,
        "company_code": "GAB",
        "company_name": "Game Company A",
        "project_code": "GAB_RPG",
        "project_name": "RPG Project",
        "api_key": "a1b2c3...(64자 hex)",
        "description": "MMORPG 쿠폰 발급 프로젝트",
        "status": 1,
        "secret_rotated_at": null,
        "created_at": "2026-07-16 10:00:00",
        "updated_at": "2026-07-16 10:00:00"
      }
    ]
  }
}
```

---

## 2.3 Get Project

### Endpoint

```http
GET /projects/{project_id}
```

### Permission

- SUPER_ADMIN
- DEVELOPER

### Business Rules

- SUPER_ADMIN: 모든 프로젝트 조회 가능
- DEVELOPER: 본인 소속 `company_id`의 프로젝트만 조회 가능

---

## 2.4 Update Project

### Endpoint

```http
PATCH /projects/{project_id}
```

### Permission

- SUPER_ADMIN

### Updatable Fields

```text
project_name
description
status
```

### Non-Updatable Fields

```text
project_id
company_id
project_code
api_key            (재발급 절차 없음 — 프로젝트 생성 시 1회 발급으로 고정)
api_secret_hash    (2.5 Rotate Project API Secret 전용)
```

### Validation

- `project_name` 최대 100자
- `description` 최대 1000자

### Business Rules

- `project.company_id`/`project_code`는 생성 후 수정 불가(변경 지양 원칙, [03_DATABASE_SCHEMA.md](./03_DATABASE_SCHEMA.md) 2장 참고)

---

## 2.5 Rotate Project API Secret

### Endpoint

```http
POST /projects/{project_id}/api-secret/rotate
```

### Permission

- SUPER_ADMIN
- DEVELOPER (해당 `project_id`에 실제 활성 `user_role`이 배정되어 있어야 함 — 없으면 20001)

### Description

기존 `api_secret_hash`를 `api_secret_hash_prev`로 이동하고 신규 Secret을 발급한다. 유예기간 동안은 기존 Secret도 함께 유효하다([04_AUTH_SECURITY.md](./04_AUTH_SECURITY.md) 2.2 Grace Period 참고).

### Request

Body 없음 (`project_id`는 path parameter로만 전달).

### Response

```json
{
  "result": 0,
  "data": {
    "project_id": 10,
    "api_secret": "n3w-s3cr3t...(평문, 이 응답에만 1회 노출)",
    "secret_rotated_at": "2026-07-16 11:00:00"
  }
}
```

### Business Rules

- `api_key`는 변경되지 않는다(Secret만 재발급 대상)
- DEVELOPER 호출 시 JWT의 `role_code`(여러 프로젝트 중 최고 권한)가 아니라 해당 `project_id`의 실제 `user_role`을 재검증한다
- 재발급 즉시 관리자가 평문을 복사해 게임서버 설정에 반영해야 한다 — 재확인 불가
- 유예기간 경과 후 배치가 `api_secret_hash_prev`를 `NULL` 처리한다

---

## 2.6 Get Project by Code (Lookup)

### Endpoint

```http
GET /projects/lookup?company_id={id}&project_code={code}
```

### Permission

- 인증 불필요 (Anonymous)

### Description

회원가입 화면 전용([06_AUTH_API.md](./06_AUTH_API.md) 4장 회원가입에서 참조). 해당 회사 소속의 활성(status=1) 프로젝트만 조회하며, `/projects/{project_id}`보다 먼저 등록해야 하는 정적 경로다.

### Response

```json
{
  "result": 0,
  "data": {
    "project_id": 10,
    "project_name": "RPG Project"
  }
}
```

미존재/비활성 시 31002.

---

# 3. 헤더 선택용 API

회사/프로젝트 목록 자체는 [07_COMPANY_API.md](./07_COMPANY_API.md) 3장 `GET /companies/active-header-data`를 따른다. 아래는 프로젝트 단위 실제 권한 조회 전용 API다.

## 3.1 Get My Role for Project

### Endpoint

```http
GET /user-roles/me?project_id={id}
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (전체 역할)

### Description

헤더에서 선택된 프로젝트에 대한 호출자의 실제 `role_code`를 조회한다. JWT의 `role_code`는 여러 프로젝트 중 최고 권한 하나뿐이라([04_AUTH_SECURITY.md](./04_AUTH_SECURITY.md) 1.6 참고), 특정 `project_id` 기준 실제 권한(사이드바·버튼 노출 제어용)은 이 API로 별도 조회해야 한다.

### Response

```json
{
  "result": 0,
  "data": {
    "project_id": 10,
    "role_code": 30
  }
}
```

### Business Rules

- SUPER_ADMIN: `user_role` 배정 여부와 무관하게 항상 `role_code: 10`
- 그 외: 해당 `project_id`에 활성 `user_role`이 없으면 `role_code: null`
- 프로젝트 변경 시(헤더 선택 변경, 회사 변경에 따른 첫 프로젝트 자동 선택 포함) 매번 재호출한다 — 화면의 메뉴/버튼 노출은 로그인 시점 JWT의 `role_code`가 아니라 이 값을 기준으로 판단한다
