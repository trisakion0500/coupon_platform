# 07_COMPANY_API.md

# Coupon Platform REST API Specification — Company

---

# 1. Common Rules

## 1.1 Response Format

공통 응답 포맷/에러코드는 [05_API_COMMON.md](./05_API_COMMON.md)를 따른다.

## 1.2 Role Definition

| Role Code | Role Name   |
| --------- | ----------- |
| 10        | SUPER_ADMIN |
| 20        | DEVELOPER   |
| 30        | MANAGER     |
| 40        | OPERATOR    |

권한은 상위(숫자가 작을수록 고권한)가 하위 권한을 모두 포함하는 누적 구조다: `SUPER_ADMIN ⊇ DEVELOPER ⊇ MANAGER ⊇ OPERATOR`.

### SUPER_ADMIN

- 회사 관리메뉴(본 문서 2장) + 프로젝트 관리메뉴([08_PROJECT_API.md](./08_PROJECT_API.md) 2장) 전체 접근(생성/수정/Secret 발급 포함)
- 쿠폰 도메인 컨트롤 전체 가능(세부는 쿠폰 도메인 설계 시점에 정의)

### DEVELOPER

- 회사 관리메뉴(본 문서 2장) 접근 불가 — 프로젝트 관리메뉴 중 **프로젝트 리스트/상세 조회, API Secret 재발급**만 가능([08_PROJECT_API.md](./08_PROJECT_API.md) 2장 참고, 프로젝트 생성/정체성 필드 수정 권한은 없음)
- 하위 권한(MANAGER/OPERATOR)의 쿠폰 도메인 컨트롤도 모두 가능(세부는 쿠폰 도메인 설계 시점에 정의)

### MANAGER

- 회사/프로젝트 관리메뉴(본 문서 2장, [08_PROJECT_API.md](./08_PROJECT_API.md) 2장) 접근 불가(20001) — 단, 헤더 선택용 API(본 문서 3장, [08_PROJECT_API.md](./08_PROJECT_API.md) 3장)는 예외적으로 접근 가능
- 쿠폰 도메인 컨트롤 즉시 가능(승인 불요, 세부는 쿠폰 도메인 설계 시점에 정의)

### OPERATOR

- 회사/프로젝트 관리메뉴(본 문서 2장, [08_PROJECT_API.md](./08_PROJECT_API.md) 2장) 접근 불가(20001) — 단, 헤더 선택용 API(본 문서 3장, [08_PROJECT_API.md](./08_PROJECT_API.md) 3장)는 예외적으로 접근 가능
- 쿠폰 도메인 컨트롤 등록 시 승인요청 상태로 전환 — SUPER_ADMIN/DEVELOPER/MANAGER가 승인 가능(세부는 쿠폰 도메인 설계 시점에 정의)

---

# 2. Company APIs

## 2.1 Create Company

### Endpoint

```http
POST /companies
```

### Permission

- SUPER_ADMIN

### Request

```json
{
  "company_code": "GAB",
  "company_name": "Game Company A",
  "description": "게임 A 운영 회사"
}
```

### Validation

- `company_code` 필수, 전역 중복 불가, 영문/숫자/`_`/`.`/`-`만 허용, 최대 20자
- `company_name` 필수, 최대 100자
- `description` 최대 1000자

### Response

등록 후 저장된 최종 데이터 반환

---

## 2.2 Get Company List

### Endpoint

```http
GET /companies
```

### Permission

- SUPER_ADMIN

### Query Parameters

| Name      | Required | Description                |
| --------- | -------- | -------------------------- |
| status    | N        |                             |
| page      | Y        |                             |
| page_size | Y        | 20/30/50/100 중 선택. 기본 20 |

### Sorting

```sql
ORDER BY status DESC,
         company_name ASC
```

### Business Rules

- SUPER_ADMIN 전용이라 항상 전체 회사 목록을 반환한다

### Response

페이지네이션 응답 형식([05_API_COMMON.md](./05_API_COMMON.md) 2장 참고)

---

## 2.3 Get Company

### Endpoint

```http
GET /companies/{company_id}
```

### Permission

- SUPER_ADMIN

### Business Rules

- SUPER_ADMIN 전용이라 모든 회사 조회 가능

---

## 2.4 Update Company

### Endpoint

```http
PATCH /companies/{company_id}
```

### Permission

- SUPER_ADMIN

### Updatable Fields

```text
company_code
company_name
description
status
```

### Non-Updatable Fields

```text
company_id
created_at
```

### Validation

- `company_code` 중복체크, 영문/숫자/`_`/`.`/`-`만 허용, 최대 20자
- `company_name` 최대 100자
- `description` 최대 1000자

### Response

저장 후 최종 데이터 반환

---

## 2.5 Get Company by Code (Lookup)

### Endpoint

```http
GET /companies/lookup?company_code={code}
```

### Permission

- 인증 불필요 (Anonymous)

### Description

회원가입 화면 전용. 로그인 전이라 `GET /companies`를 호출할 수 없어 신설된 공개 엔드포인트([06_AUTH_API.md](./06_AUTH_API.md) 4장 회원가입에서 참조). 활성(status=1) 회사만 조회하며, `/companies/{company_id}`보다 먼저 등록해야 하는 정적 경로다.

### Response

```json
{
  "result": 0,
  "data": {
    "company_id": 1,
    "company_name": "Game Company A"
  }
}
```

민감정보는 반환하지 않는다. 미존재/비활성 시 31001.

---

# 3. 헤더 선택용 API

관리 콘솔 헤더의 회사/프로젝트 선택 콤보박스 전용 API. 2장의 관리메뉴 API와 달리 **모든 역할이 접근 가능**하다 — 회사/프로젝트 관리 권한이 없어도(MANAGER/OPERATOR), 현재 어느 회사·프로젝트 컨텍스트에서 작업 중인지는 알아야 쿠폰 도메인 화면이 동작하기 때문이다. 로그인 시 1회 로드하고, 이후 등록/수정 시점에 프런트엔드에서 직접 동기화한다. 프로젝트 단위 헤더 API(선택된 프로젝트의 실제 role_code 조회)는 [08_PROJECT_API.md](./08_PROJECT_API.md) 3장 참고.

## 3.1 Get Active Header Data

### Endpoint

```http
GET /companies/active-header-data
```

### Permission

- SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (전체 역할)

### Description

로그인 직후 헤더 콤보박스가 1회 로드하는 활성 회사·프로젝트 목록을 한 호출로 반환한다. `2.2 Get Company List`(본 문서)/`2.2 Get Project List`([08_PROJECT_API.md](./08_PROJECT_API.md))는 관리메뉴용 페이지네이션 응답이라, 이를 `page_size` 상한(100)으로 재사용하는 방식은 활성 회사/프로젝트가 100건을 넘으면 조용히 누락되는 문제가 있어 채택하지 않는다 — 페이지네이션 없는 전용 엔드포인트로 별도 제공한다. `/companies/{company_id}`보다 먼저 등록해야 하는 정적 경로다.

### Business Rules

- SUPER_ADMIN: 전체 회사 + 전체 프로젝트 반환("전체 회사"/"전체 프로젝트" 옵션으로 사용)
- 그 외: 본인 소속 회사 1건 + 본인이 활성 `user_role`(status=1)을 배정받은 프로젝트만 반환 — 같은 회사 소속이어도 role 미배정 프로젝트는 제외

### Response

```json
{
  "result": 0,
  "data": {
    "companies": [
      { "company_id": 1, "company_name": "Game Company A" }
    ],
    "projects": [
      { "project_id": 10, "company_id": 1, "project_name": "RPG Project" }
    ]
  }
}
```
