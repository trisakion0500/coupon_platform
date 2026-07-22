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
| project    | api_secret, api_secret_prev | `"***"` |

`PATCH /auth/password`([09_AUTH_API.md](./09_AUTH_API.md) 9장), `POST /users/{user_id}/reset-password`([12_USER_API.md](./12_USER_API.md) 1.7) 호출 시 `user` 테이블 UPDATE 감사 로그가 생성되며, 이때 `password_hash`는 마스킹된다.

`POST /projects`([11_PROJECT_API.md](./11_PROJECT_API.md) 2.1), `PATCH /projects/{project_id}`(2.4), `POST /projects/{project_id}/api-secret/rotate`(2.5) 호출 시 `project` 테이블 CREATE/UPDATE 감사 로그가 생성되며, 이때 `api_secret`/`api_secret_prev`는 마스킹된다(AES-256-CBC 암호문이라도 `ENCRYPTION_KEY` 유출 시 복호화가 가능하므로 `password_hash`와 동일 수준으로 취급).

## 2.5 수정 및 삭제 정책

감사 로그는 Append-Only 정책을 따른다. 생성/수정/삭제/상태변경 API를 지원하지 않으며, 시스템 내부에서만 생성된다.

## 2.6 대상 SP 및 action 매핑

각 엔드포인트가 실제로 어떤 `action`으로 기록되는지는 다음과 같다(2026-07-20 구현 확정). `approve`/`reject`처럼 상태 전이 자체가 목적인 엔드포인트만 STATUS_CHANGE(30)로 기록하고, 그 외 생성/수정 엔드포인트는 CREATE(10)/UPDATE(20)로 기록한다 — 일반 수정 API가 `status` 필드를 함께 바꾸는 경우(예: `PATCH /companies/{id}`, `PATCH /users/{id}`)에도 UPDATE(20)로만 기록하며 별도로 STATUS_CHANGE로 구분하지 않는다.

| table_name | Endpoint | SP | action |
| ---------- | -------- | -- | ------ |
| company | `POST /companies` | `SP_COMPANY_CREATE` | 10 CREATE |
| company | `PATCH /companies/{company_id}` | `SP_COMPANY_UPDATE` | 20 UPDATE |
| project | `POST /projects` | `SP_PROJECT_CREATE` | 10 CREATE |
| project | `PATCH /projects/{project_id}` | `SP_PROJECT_UPDATE` | 20 UPDATE |
| project | `POST /projects/{project_id}/api-secret/rotate` | `SP_PROJECT_API_SECRET_ROTATE` | 20 UPDATE |
| user | `POST /users/{user_id}/approve` | `SP_USER_APPROVE` | 30 STATUS_CHANGE |
| user | `POST /users/{user_id}/reject` | `SP_USER_REJECT` | 30 STATUS_CHANGE |
| user | `PATCH /users/{user_id}` | `SP_USER_UPDATE` | 20 UPDATE |
| user | `POST /users/{user_id}/reset-password` | `SP_USER_PASSWORD_RESET` | 20 UPDATE |
| user | `PATCH /auth/password`([09_AUTH_API.md](./09_AUTH_API.md) 9장) | `SP_USER_PASSWORD_CHANGE` | 20 UPDATE |
| user_role | `POST /user-roles` | `SP_USER_ROLE_CREATE` | 10 CREATE |
| user_role | `PATCH /user-roles/{user_id}/{project_id}` | `SP_USER_ROLE_UPDATE` | 20 UPDATE |

각 SP는 UPDATE/STATUS_CHANGE 직전에 변경 전 행을 캡처해 `before_json`으로, CREATE/UPDATE/STATUS_CHANGE 완료 후 행을 `after_json`으로 결과 SELECT에 함께 반환한다(SP 내부 캡처 — TS 서비스 레이어가 별도로 조회하지 않고 SP가 반환한 값을 그대로 `SP_LOG_AUDIT_CREATE`에 전달). `requester_name`(`created_by_name` 스냅샷)도 JWT 페이로드에 `user_name`이 없어 SP가 `user` 테이블을 직접 조회해 채운다. `before_json` 캡처는 `SELECT ... FOR UPDATE`로 대상 행을 잠근 뒤 UPDATE까지 하나의 트랜잭션으로 처리한다(2026-07-22) — 캡처를 락 없는 별도 SELECT로 UPDATE보다 먼저 실행하면 그 사이 다른 트랜잭션이 같은 행을 커밋했을 때 실제 직전 상태가 아닌 더 오래된 상태가 로그에 남을 수 있어, 캡처 시점부터 행을 잠가 이 레이스 윈도우를 제거했다.

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
ORDER BY created_at DESC, idx DESC
```

`created_at`은 초 단위 정밀도(마이크로초 없음)라 같은 초 안에 두 로그가 생성되면(예: CREATE 직후 곧바로 UPDATE) 단독으로는 순서가 보장되지 않는다(2026-07-22 스모크 테스트에서 실제 재현). `idx`(AUTO_INCREMENT)를 2차 키로 더해 생성 순서를 항상 정확히 보존한다.

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

## 조회 오류

| 코드  | 설명        |
| ----- | ----------- |
| 31008 | 감사 로그 없음 |

## 시스템 오류

| 코드  | 설명              |
| ----- | ----------------- |
| 50000 | 시스템 오류       |
| 50001 | 데이터베이스 오류 |
