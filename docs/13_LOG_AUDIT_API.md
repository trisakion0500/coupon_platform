# 13_LOG_AUDIT_API.md

# Coupon Platform REST API Specification — Audit Log

---

# 1. 개요

본 문서는 Coupon Platform 감사 로그(Audit Log) 조회 API 명세를 정의한다.

감사 로그는 관리 콘솔 데이터 변경 이력을 추적하기 위한 Append-Only 데이터이며, 시스템에 의해 자동 생성된다. 사용자는 감사 로그를 조회할 수만 있으며 직접 생성/수정/삭제할 수 없다.

공통 응답 포맷/에러코드는 [08_API_COMMON.md](./08_API_COMMON.md)를 따른다. Role 정의는 [10_COMPANY_API.md](./10_COMPANY_API.md) 1.2를 따른다.

---

# 2. 공통 정책

## 2.1 감사 대상 테이블

감사 로그 생성 대상([04_DATABASE_SCHEMA.md](./04_DATABASE_SCHEMA.md) 9장 참고)

```text
company
project
user
user_role
```

감사 로그 생성 제외 대상

```text
user_session (세션 이력 테이블이므로 제외)
log_audit (자기 자신, Append-Only 원칙)
```

쿠폰 도메인(캠페인/코드 등) 테이블은 설계 완료 후 자체 이벤트 로그로 별도 관리하며, 본 감사 로그 대상에는 포함하지 않는다([04_DATABASE_SCHEMA.md](./04_DATABASE_SCHEMA.md) 9장 참고).

## 2.2 작업 유형(Action Type)

| 값  | 설명          |
| --- | ------------- |
| 10  | CREATE        |
| 20  | UPDATE        |
| 30  | STATUS_CHANGE |

## 2.3 저장 정책

모든 감사 로그는 생성 시점의 데이터를 JSON 스냅샷 형태로 저장한다.

CREATE

```text
before_json = NULL
after_json = 생성 후 전체 Row
```

UPDATE

```text
before_json = 수정 전 전체 Row
after_json = 수정 후 전체 Row
```

STATUS_CHANGE

```text
before_json = 상태 변경 전 전체 Row
after_json = 상태 변경 후 전체 Row
```

## 2.4 민감 필드 마스킹 규칙

`before_json`/`after_json` 저장 시 아래 필드는 보안상 마스킹하여 저장한다.

| table_name | 마스킹 필드   | 저장 값 |
| ---------- | ------------- | ------- |
| user       | password_hash | `"***"` |

`PATCH /auth/password`([09_AUTH_API.md](./09_AUTH_API.md) 9장), `POST /users/{user_id}/reset-password`([12_USER_API.md](./12_USER_API.md) 1.7) 호출 시 `user` 테이블 UPDATE 감사 로그가 생성되며, 이때 `password_hash`는 마스킹된다.

## 2.5 수정 및 삭제 정책

감사 로그는 Append-Only 정책을 따른다. 생성/수정/삭제/상태변경 API를 지원하지 않으며, 시스템 내부에서만 생성된다.

---

# 3. 권한 정책

| Role      | 조회 범위                     |
| --------- | ------------------------------ |
| SUPER_ADMIN | 모든 감사 로그 조회 가능      |
| DEVELOPER | 본인 소속 `company_id` 데이터만 조회 가능 |
| MANAGER   | 조회 불가                      |
| OPERATOR  | 조회 불가                      |

MANAGER/OPERATOR는 회사/프로젝트/사용자 관리메뉴 자체에 접근 권한이 없으므로([10_COMPANY_API.md](./10_COMPANY_API.md) 1.2 참고) 그 변경 이력인 감사 로그도 조회 대상이 아니다.

---

# 4. API 목록

| Method | URI                        | 설명                |
| ------ | -------------------------- | ------------------- |
| GET    | /log-audits                | 감사 로그 목록 조회 |
| GET    | /log-audits/{idx}          | 감사 로그 상세 조회 |

특정 대상의 변경 이력 조회 또는 최신 이력 조회는 `/log-audits` 목록 API의 Query Parameter로 처리한다.

---

# 5. 감사 로그 목록 조회

## Endpoint

```http
GET /log-audits
```

## Permission

- SUPER_ADMIN
- DEVELOPER (본인 소속 회사로 스코핑)

## Query Parameters

| 이름            | 필수 | 설명                                               |
| --------------- | ---- | -------------------------------------------------- |
| company_id      | N    | 회사 ID(SUPER_ADMIN만 유효, DEVELOPER는 본인 소속으로 고정 스코핑) |
| project_id      | N    | 프로젝트 ID                                        |
| table_name      | N    | 대상 테이블명(company/project/user/user_role)      |
| target_id       | N    | 대상 식별자                                        |
| action          | N    | 작업 유형 (10:CREATE, 20:UPDATE, 30:STATUS_CHANGE) |
| from_created_at | N    | 시작 일시                                          |
| to_created_at   | N    | 종료 일시                                          |
| page            | Y    | 페이지 번호                                        |
| page_size       | Y    | 20/30/50/100 중 선택. 기본 20                       |

## 사용 패턴

특정 대상 전체 변경 이력 조회

```http
GET /log-audits?table_name=user&target_id=100
```

특정 대상 최신 변경 이력 조회

```http
GET /log-audits?table_name=user&target_id=100&page=1&page_size=1
```

## Response

```json
{
  "result": 0,
  "data": {
    "page": 1,
    "page_size": 20,
    "total_count": 2,
    "items": [
      {
        "idx": 1001,
        "company_id": 1,
        "project_id": null,
        "table_name": "user",
        "target_id": "3",
        "target_name": "Manager",
        "action": 30,
        "created_by": 1,
        "created_by_name": "Super Admin",
        "created_at": "2026-07-16 10:00:00"
      }
    ]
  }
}
```

## Sorting

```sql
ORDER BY created_at DESC
```

---

# 6. 감사 로그 상세 조회

## Endpoint

```http
GET /log-audits/{idx}
```

## Permission

- SUPER_ADMIN
- DEVELOPER (본인 소속 회사로 스코핑)

## Response

```json
{
  "result": 0,
  "data": {
    "idx": 1001,
    "company_id": 1,
    "project_id": null,
    "table_name": "user",
    "target_id": "3",
    "target_name": "Manager",
    "action": 30,
    "before_json": { "...": "생략" },
    "after_json": { "...": "생략" },
    "created_by": 1,
    "created_by_name": "Super Admin",
    "created_at": "2026-07-16 10:00:00"
  }
}
```

---

# 7. 오류 코드

## 권한 오류

| 코드  | 설명      |
| ----- | --------- |
| 20001 | 권한 없음 |

## 시스템 오류

| 코드  | 설명              |
| ----- | ----------------- |
| 50000 | 시스템 오류       |
| 50001 | 데이터베이스 오류 |
