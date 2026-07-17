# 06_AUTH_API.md

## 1. 개요

본 문서는 Coupon Platform 관리 콘솔의 사용자 인증(Authentication) API를 정의한다.

인증은 Login ID / Password 기반으로 수행한다. 인증 성공 시 Access Token을 발급한다. 가입 사용자는 승인 이후에만 로그인할 수 있다.

토큰 방식/만료 정책/세션 관리/Rate Limit/JWT Payload/role_code 계산 규칙 등 정책 상세는 [04_AUTH_SECURITY.md](./04_AUTH_SECURITY.md) 1장을 따른다. 공통 응답 포맷/에러코드 전체 목록은 [05_API_COMMON.md](./05_API_COMMON.md)를 따른다.

---

## 2. 인증 정책

### 2.1 사용자 상태

| 값  | 설명         |
| --- | ------------ |
| 0   | 가입승인대기 |
| 1   | 가입승인     |
| 2   | 가입반려     |
| 3   | 사용중지     |

### 2.2 로그인 가능/불가 상태

```text
로그인 가능 : 1 (가입승인)
로그인 불가 : 0 (가입승인대기), 2 (가입반려), 3 (사용중지)
```

---

## 3. API 목록

| Method | URI            | 설명                | 인증 필요 |
| ------ | -------------- | ------------------- | --------- |
| POST   | /auth/signup   | 회원가입            | N         |
| POST   | /auth/login    | 로그인              | N         |
| POST   | /auth/logout   | 로그아웃            | Y         |
| POST   | /auth/refresh  | Access Token 재발급 | N (Refresh Token 필요) |
| GET    | /auth/me       | 내 정보 조회        | Y         |
| PATCH  | /auth/password | 비밀번호 변경       | Y         |

---

## 4. 회원가입

### POST /auth/signup

#### Request

```json
{
  "company_id": 1,
  "requested_project_id": 1,
  "login_id": "trisakion",
  "password": "생략",
  "user_name": "홍길동",
  "email": "test@test.com",
  "phone_number": "010-1234-5678",
  "department": "개발팀",
  "position": "사원"
}
```

`company_id`/`requested_project_id`는 회사/프로젝트 코드(`company_code`/`project_code`)를 미리 조회해 얻은 ID를 사용한다. 코드→ID 변환은 [07_COMPANY_API.md](./07_COMPANY_API.md) 2.5 `GET /companies/lookup`, [08_PROJECT_API.md](./08_PROJECT_API.md) 2.6 `GET /projects/lookup`을 따른다.

#### 처리 정책

```text
user.status = 0 (가입승인대기)
```

`login_id`는 영문(a-z, A-Z), 숫자(0-9), `_`, `.`, `-`만 허용한다. 그 외 문자 포함 시 30002(입력값 형식 오류).
`phone_number`는 필수이며 서버에서 AES-256-CBC로 암호화되어 저장된다(평문 최대 20자). `department`/`position`은 선택 입력.

IP당 요청 제한이 적용된다([04_AUTH_SECURITY.md](./04_AUTH_SECURITY.md) 1.4 참고).

#### Response

생성된 User 전체 정보 반환

---

## 5. 로그인

### POST /auth/login

#### Request

```json
{
  "login_id": "trisakion",
  "password": "생략"
}
```

#### Response

```json
{
  "result": 0,
  "data": {
    "access_token": "생략",
    "refresh_token": "생략",
    "expired_at": "2026-07-16 12:15:00",
    "role_code": 20
  }
}
```

`role_code`는 사용자가 활성 상태(`user_role.status=1`)로 배정된 모든 프로젝트 중 최고 권한(`MIN(role_code)`, 미배정 시 40)이다. JWT 페이로드에도 동일 값이 포함되며 세션 내내 고정된다([04_AUTH_SECURITY.md](./04_AUTH_SECURITY.md) 1.6 참고).

IP당 요청 제한이 적용된다([04_AUTH_SECURITY.md](./04_AUTH_SECURITY.md) 1.4 참고).

#### 처리 정책

```text
last_login_at 갱신
user_session 생성
access_token 발급
refresh_token 발급
```

---

## 6. 로그아웃

### POST /auth/logout

현재 Session 종료

#### 처리 정책

```text
user_session.status = 0
```

---

## 7. Access Token 재발급

### POST /auth/refresh

#### Request

```json
{
  "refresh_token": "생략"
}
```

#### Response

```json
{
  "result": 0,
  "data": {
    "access_token": "생략",
    "expired_at": "2026-07-16 12:45:00",
    "role_code": 20
  }
}
```

`role_code`는 로그인 시점에 계산되어 `user_session`에 저장된 값을 그대로 반환한다. 재발급 시 재계산하지 않는다.

#### 처리 정책

```text
Refresh Token 검증
Session 상태 검증
User 상태 검증
신규 Access Token 발급
```

---

## 8. 내 정보 조회

### GET /auth/me

현재 로그인 사용자 정보 조회

#### Response

```json
{
  "result": 0,
  "data": {
    "user_id": 1,
    "company_id": 1,
    "requested_project_id": 1,
    "login_id": "trisakion",
    "user_name": "홍길동",
    "email": "test@test.com",
    "phone_number": "010-1234-5678",
    "department": "개발팀",
    "position": "사원",
    "status": 1,
    "last_login_at": "2026-07-16 10:00:00",
    "created_at": "2026-07-10 10:00:00",
    "updated_at": "2026-07-16 10:00:00"
  }
}
```

`user` 테이블 원본 컬럼만 반환하며 `role_code`는 포함하지 않는다. `role_code`는 프로젝트마다 다를 수 있어 user 엔티티의 고정 속성이 아니기 때문이다([04_AUTH_SECURITY.md](./04_AUTH_SECURITY.md) 1.6 참고). 필요하면 로그인/재발급 응답의 `role_code`(세션 고정값)를 사용한다.

---

## 9. 비밀번호 변경

### PATCH /auth/password

#### Request

```json
{
  "current_password": "생략",
  "new_password": "생략"
}
```

#### 처리 정책

```text
기존 비밀번호 검증
신규 비밀번호 저장

모든 활성 Session 종료
user_session.status = 0 WHERE user_id = ? AND status = 1
```

---

## 10. 오류 코드

본 API에서 사용하는 오류 코드는 [05_API_COMMON.md](./05_API_COMMON.md) 8장 전체 오류 코드 목록 중 아래 범위를 사용한다.

```text
10001~10009 : Authentication (로그인 실패, 가입승인대기/반려, 사용중지 등)
30001~30003 : Validation (입력값)
32001       : 중복 데이터 (login_id/email 중복 등)
40001       : Rate Limit 초과
```
