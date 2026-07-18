# 07_API_COMMON.md

## 개요

본 문서는 Coupon Platform 관리 콘솔 API의 공통 규약을 정의한다.

적용 구간

```text
관리 콘솔 Frontend ↔ Coupon Platform API
```

게임서버 ↔ Coupon Platform 간 S2S 호출 규약은 [06_AUTH_SECURITY.md](./06_AUTH_SECURITY.md) 2장을 따른다. 사용자 인증(토큰/세션) 정책은 [06_AUTH_SECURITY.md](./06_AUTH_SECURITY.md) 1장에 정의되어 있으며, 본 문서에서는 반복하지 않는다.

---

# 1. HTTP Status Code 정책

Coupon Platform API는 HTTP Status Code와 Result Code를 함께 사용한다. 클라이언트는 HTTP Status Code와 Result Code를 모두 확인해야 한다.

## 1.1 Result Code 범위

| Range       | Description    |
| ----------- | -------------- |
| 0           | Success        |
| 10000~19999 | Authentication |
| 20000~29999 | Authorization  |
| 30000~39999 | Validation     |
| 40000~49999 | Rate Limit     |
| 50000~59999 | System         |

## 1.2 Validation 세부 범위

| Range       | Description                |
| ----------- | --------------------------- |
| 30000~30999 | 입력값 오류                |
| 31000~31999 | 조회 대상 없음 (Not Found) |
| 32000~32999 | 중복 데이터                |

## 1.3 HTTP Status Code 매핑

| HTTP Status               | Result Range | Description             |
| -------------------------- | ------------ | ------------------------ |
| 200 OK                    | 0            | 정상 처리                |
| 202 Accepted               | 0            | 비동기 처리 접수(즉시 완료되지 않음, 예: 쿠폰 코드 대량생성) |
| 400 Bad Request            | 30000~39999  | Validation               |
| 401 Unauthorized           | 10000~19999  | Authentication            |
| 403 Forbidden              | 20000~29999  | Authorization             |
| 404 Not Found              | 31000~31999  | Validation (Not Found)   |
| 429 Too Many Requests      | 40000~49999  | Rate Limit                |
| 500 Internal Server Error  | 50000~59999  | System                    |

## 1.4 응답 예시

### 200 OK

```json
{
  "result": 0,
  "data": {}
}
```

### 400 Bad Request

```json
{
  "result": 30001,
  "message": "Invalid parameter"
}
```

### 401 Unauthorized

```json
{
  "result": 10004,
  "message": "Login required"
}
```

### 403 Forbidden

```json
{
  "result": 20001,
  "message": "Permission denied"
}
```

### 404 Not Found

```json
{
  "result": 31003,
  "message": "User not found"
}
```

### 429 Too Many Requests

```json
{
  "result": 40001,
  "message": "Too many requests"
}
```

### 500 Internal Server Error

```json
{
  "result": 50000,
  "message": "Internal server error"
}
```

## 1.5 오류 처리 원칙

비즈니스 오류를 HTTP 200으로 반환하지 않는다. 모든 비정상 상황은 적절한 HTTP Status Code와 Result Code를 함께 반환한다.

```text
사용자 없음   → 404 Not Found
권한 없음     → 403 Forbidden
```

---

# 2. Pagination 정책

## 2.1 적용 대상

| API              | 설명        |
| ----------------- | ----------- |
| GET /companies    | 회사 목록   |
| GET /projects     | 프로젝트 목록 |
| GET /users        | 사용자 목록 |
| GET /log-audits   | 감사 로그 목록 |
| GET /campaigns    | 캠페인 목록 |
| GET /campaigns/{id}/codes | 쿠폰 코드 목록 |

## 2.2 미적용 대상 (전체 로드)

| API             | 표현 방식                  |
| --------------- | --------------------------- |
| GET /user-roles | 유저 상세 하위 데이터그리드 |

## 2.3 요청 파라미터

| Name      | Required | Description                   |
| --------- | -------- | ------------------------------ |
| page      | Y        | 페이지 번호 (1부터 시작)       |
| page_size | Y        | 20/30/50/100 중 선택. 기본 20  |

## 2.4 응답 형식

```json
{
  "result": 0,
  "data": {
    "page": 1,
    "page_size": 20,
    "total_count": 100,
    "items": [
      { "...": "생략" }
    ]
  }
}
```

---

# 3. 배열 응답 정책

배열 타입 필드는 `null`을 허용하지 않으며 데이터가 없을 경우 빈 배열 `[]`로 반환한다.

---

# 4. 날짜/시간 형식

## 4.1 형식

```text
YYYY-MM-DD HH:mm:ss
```

예시: `2026-06-22 10:00:00`

## 4.2 전송 방식

날짜/시간 값은 문자열(String)로 전송한다.

## 4.3 타임존 정책

API 요청/응답 및 데이터베이스 저장 시 타임존 변환을 수행하지 않는다. 서비스와 데이터베이스는 동일한 타임존 환경에서 운영한다.

---

# 5. 보안 정책

## 5.1 CORS 정책

허용 오리진은 환경변수(`CORS_ALLOWED_ORIGINS`)로 관리하며, 미등록 오리진의 요청은 차단한다.

## 5.2 CSP (Content-Security-Policy) 정책

`helmet()`의 기본 정책을 그대로 사용한다.

```text
default-src 'self'; base-uri 'self'; font-src 'self' https: data:; form-action 'self';
frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'self';
script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; upgrade-insecure-requests
```

이 서비스는 순수 JSON API라 브라우저가 HTML로 렌더링할 대상이 없어 CSP가 실제로 무언가를 차단하는 상황은 거의 없다 — 프록시(nginx 등) 유무를 가정하지 않고 앱 레벨에서도 최소한의 보안 헤더를 갖추기 위한 방어적 설정이다.

`SWAGGER_ENABLED=true`(Swagger UI, HTML)일 때는 인라인 스크립트/스타일이 CSP에 막히므로 CSP만 비활성화하고 나머지 헤더(HSTS, X-Frame-Options, X-Content-Type-Options 등)는 그대로 유지한다.

## 5.3 Rate Limiting 정책

세부 정책은 [06_AUTH_SECURITY.md](./06_AUTH_SECURITY.md) 1.4 참고.

알고리즘은 Fixed Window Counter를 사용한다(`express-rate-limit` 동일 계열 라이브러리 기준). 윈도우 경계에서 최대 `max`의 2배까지 통과하는 경계 버스트가 이론상 가능하지만, 초 단위로 정밀하게 막아야 하는 시나리오가 아니라 로그인 브루트포스 방지 목적으로는 충분해 슬라이딩 윈도우 등 별도 라이브러리는 채택하지 않는다.

## 5.4 세션 정리(Session Cleanup) 정책

세부 정책은 [06_AUTH_SECURITY.md](./06_AUTH_SECURITY.md) 1.3 참고.

서버 기동 시 `node-cron` 계열로 크론 잡을 등록하고, 만료 세션을 정리하는 Stored Procedure를 호출해 대상 행을 DELETE한다. `expired_at`은 로그인 시점에 `JWT_REFRESH_EXPIRES_IN`만큼 더한 절대 시각으로 이미 저장돼 있어, 정리 로직은 만료 기간 값 자체를 알 필요 없이 `NOW()`와 비교만 하면 된다 — `JWT_REFRESH_EXPIRES_IN`을 바꿔도 정리 로직 수정은 불필요하다. `status=1`(활성)이면서 아직 만료되지 않은 세션은 조건에 걸리지 않아 삭제되지 않는다.

---

# 6. Health Check

## Endpoint

```http
GET /health
```

## Permission

Anonymous (인증 불필요)

## Response

```json
{
  "result": 0,
  "data": {
    "status": "ok"
  }
}
```

## 용도

```text
서버 기동 확인
로드밸런서 헬스체크
배포 후 정상 기동 여부 확인
```

---

# 7. 입력값 형식 제약

| 필드            | 허용 문자                          | 길이                          |
| --------------- | ----------------------------------- | ----------------------------- |
| `login_id`      | 영문 대소문자, 숫자, `_`, `.`, `-`  | 제한 없음(DB 컬럼 100자)      |
| `password`      | 제한 없음                           | 4 ~ 72자                      |
| `email`         | 이메일 형식                         | 최대 200자                    |
| `user_name`     | 제한 없음                           | 최대 100자                    |
| `phone_number`  | 제한 없음(서버에서 AES-256-CBC 암호화 저장) | 평문 기준 최대 20자       |
| `department`    | 제한 없음                           | 최대 100자                    |
| `position`      | 제한 없음                           | 최대 100자                    |
| `company_code`  | 영문 대소문자, 숫자, `_`, `.`, `-`  | 1 ~ 20자                      |
| `company_name`  | 제한 없음                           | 최대 100자                    |
| `project_code`  | 영문 대소문자, 숫자, `_`, `.`, `-`  | 1 ~ 20자                      |
| `project_name`  | 제한 없음                           | 최대 100자                    |
| `description`(company/project 공통) | 제한 없음     | 최대 1000자                   |
| `name`(campaign)| 제한 없음                           | 최대 100자                    |
| `code_value`(FIXED) | 제한 없음(관리자 입력값 그대로 사용) | 1 ~ 50자                  |
| `reject_reason` | 제한 없음                           | 최대 500자                    |

---

# 8. 전체 오류 코드 목록

## 10000 — Authentication

| 코드  | 설명                  |
| ----- | --------------------- |
| 10001 | 로그인 실패           |
| 10002 | 비밀번호 불일치       |
| 10003 | Access Token 만료     |
| 10004 | 로그인 필요           |
| 10005 | 가입승인대기          |
| 10006 | 가입반려              |
| 10007 | 사용중지 계정         |
| 10008 | Refresh Token 만료    |
| 10009 | 유효하지 않은 Session |

## 20000 — Authorization

| 코드  | 설명      |
| ----- | --------- |
| 20001 | 권한 없음 |

## 30000 — Validation (입력값)

| 코드  | 설명             |
| ----- | ---------------- |
| 30001 | 필수 입력값 누락 |
| 30002 | 입력값 형식 오류 |
| 30003 | 허용되지 않은 값 |
| 30004 | 상태 전이 불가(현재 상태에서 허용되지 않는 처리 요청) |

## 31000 — Validation (Not Found)

| 코드  | 설명          |
| ----- | ------------- |
| 31001 | 회사 없음     |
| 31002 | 프로젝트 없음 |
| 31003 | 사용자 없음   |
| 31004 | 캠페인 없음   |

## 32000 — Validation (중복)

| 코드  | 설명        |
| ----- | ----------- |
| 32001 | 중복 데이터 |

## 40000 — Rate Limit

| 코드  | 설명           |
| ----- | -------------- |
| 40001 | 요청 제한 초과 |

## 50000 — System

| 코드  | 설명                        |
| ----- | --------------------------- |
| 50000 | 시스템 오류(서버 내부 오류) |
| 50001 | 데이터베이스 오류(SP 내부 오류) |

캠페인/코드 발급 관련 오류 코드는 위 표에 반영 완료([16_CAMPAIGN_API.md](./16_CAMPAIGN_API.md) 참고). 쿠폰 사용(reserve/confirm) 관련 오류 코드는 해당 API 상세 스펙 확정 후 이 표에 추가한다.
