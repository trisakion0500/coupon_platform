# 12_USER_API.md

# Coupon Platform REST API Specification — User / UserRole

---

## 공통 규약

공통 응답 포맷/에러코드는 [08_API_COMMON.md](./08_API_COMMON.md)를 따른다. Role 정의는 [10_COMPANY_API.md](./10_COMPANY_API.md) 1.2를 따른다.

본 문서의 엔드포인트는 기본적으로 **SUPER_ADMIN 전용**이다. DEVELOPER의 관리메뉴 권한은 프로젝트 리스트/상세/API Secret 재발급으로 한정되어 있어([10_COMPANY_API.md](./10_COMPANY_API.md) 1.2, [11_PROJECT_API.md](./11_PROJECT_API.md) 2장 참고) 사용자 승인/역할배정 같은 계정 거버넌스 작업에는 포함되지 않는다 — 단, **사용자 목록/상세 조회(1.1~1.3)는 예외적으로 DEVELOPER도 가능**(본인 소속 회사로 스코핑).

---

# 1. User APIs

## 1.1 Get User List

### Endpoint

```http
GET /users
```

### Permission

- SUPER_ADMIN
- DEVELOPER (본인 소속 회사로 스코핑)

### Query Parameters

| Name       | Required | Description                                                        |
| ---------- | -------- | ------------------------------------------------------------------- |
| company_id | N        | SUPER_ADMIN만 유효(DEVELOPER는 항상 본인 소속 회사로 고정 스코핑)   |
| status     | N        | DEVELOPER도 자유롭게 필터 가능(본인 소속 회사 스코핑은 별개로 적용) |
| page       | Y        |                                                                       |
| page_size  | Y        | 20/30/50/100 중 선택. 기본 20                                        |

### Sorting

`user.status`는 다른 테이블과 성격이 달라(가입승인대기가 가장 먼저 보여야 함) ASC로 정렬한다.

```sql
ORDER BY status ASC,
         user_name ASC
```

### Response

페이지네이션 응답 형식([08_API_COMMON.md](./08_API_COMMON.md) 2장 참고)

---

## 1.2 Get Pending Signup Users

### Endpoint

```http
GET /users?status=0
```

### Permission

- SUPER_ADMIN
- DEVELOPER (본인 소속 회사 사용자에 한해)

### Description

가입 승인 대기 사용자 조회. `1.1 Get User List`와 동일한 엔드포인트이며 `status` 파라미터 유무만 다르다.

### Business Rules

- 가입 승인 화면에서 사용
- `requested_project_id` 확인 가능(승인 시 어떤 프로젝트에 역할을 배정해야 할지 참고)

---

## 1.3 Get User

### Endpoint

```http
GET /users/{user_id}
```

### Permission

- SUPER_ADMIN
- DEVELOPER (본인 소속 회사 사용자에 한해)

### Business Rules

- SUPER_ADMIN: 모든 사용자 조회 가능
- DEVELOPER: 본인 소속 `company_id`의 사용자만 조회 가능

---

## 1.4 Approve User

### Endpoint

```http
POST /users/{user_id}/approve
```

### Permission

- SUPER_ADMIN

### State Transition

```text
0 → 1
```

### Response

저장 후 최종 데이터 반환

---

## 1.5 Reject User

### Endpoint

```http
POST /users/{user_id}/reject
```

### Permission

- SUPER_ADMIN

### State Transition

```text
0 → 2
```

### Request

```json
{}
```

### Response

저장 후 최종 데이터 반환

---

## 1.6 Update User

### Endpoint

```http
PATCH /users/{user_id}
```

### Permission

- SUPER_ADMIN

### Updatable Fields

```text
user_name
email
phone_number
department
position
status
```

### Non-Updatable Fields

```text
user_id
company_id
requested_project_id
login_id
```

### State Transition

```text
0 → 1 : 가입승인 절차이므로 제외됨(1.4 사용)
0 → 2 : 가입승인 절차이므로 제외됨(1.5 사용)
0 → 3 : 불가
1 → 2 : 가입승인 절차이므로 제외됨
1 → 3 : 가능
3 → 1 : 가능
```

> 위 표는 화면(사용자 상세)이 상태별로 노출하는 액션 버튼 기준의 설계 의도이며, 실제 저장 프로시저는 status 값 전이를 검증하지 않는다(그대로 반영). API를 직접 호출하면 임의의 status 값 전달이 가능하다.

### Business Rules

- `status = 3`(사용중지) 변경 시 해당 사용자의 모든 활성 Session 즉시 종료([07_AUTH_SECURITY.md](./07_AUTH_SECURITY.md) 1.3 참고)

### Response

저장 후 최종 데이터 반환

---

## 1.7 Reset User Password

### Endpoint

```http
POST /users/{user_id}/reset-password
```

### Permission

- SUPER_ADMIN

### Description

관리자가 특정 사용자의 비밀번호를 강제 초기화한다. 본인 비밀번호 변경(`PATCH /auth/password`, [09_AUTH_API.md](./09_AUTH_API.md) 9장)과 달리 현재 비밀번호 검증 없이 즉시 변경한다.

### Request

```json
{
  "new_password": "1234"
}
```

### Validation

- `new_password` 필수

### Business Rules

- `current_password` 검증 없이 즉시 변경
- 변경 후 해당 사용자의 모든 활성 Session 즉시 종료(`user_session.status = 0 WHERE user_id = ? AND status = 1`)
- 감사 로그(`log_audit`) 기록 — `password_hash`는 `"***"`로 마스킹

### Response

저장 후 최종 데이터 반환

---

# 2. User Status

| 값  | 설명         |
| --- | ------------ |
| 0   | 가입승인대기 |
| 1   | 가입승인     |
| 2   | 가입반려     |
| 3   | 사용중지     |

### Allowed State Transition

```text
0 → 1
0 → 2
1 → 3
3 → 1
```

---

# 3. User Role APIs

## 3.1 Create User Role

### Endpoint

```http
POST /user-roles
```

### Permission

- SUPER_ADMIN

### Request

```json
{
  "user_id": 100,
  "project_id": 10,
  "role_code": 40
}
```

### Validation

- `user_id` 존재
- `project_id` 존재
- `user`와 `project`의 `company_id` 일치 필요(다른 회사 소속 프로젝트에는 등록 불가)
- `role_code` = 20, 30, 40 중 하나

### Business Rules

- SUPER_ADMIN(10)으로는 등록 불가 — SUPER_ADMIN은 프로젝트 배정과 무관하게 전체 접근 권한을 가지므로 이 API의 대상이 아님
- 동일 `user_id` + `project_id` 중복 등록 불가

### Response

저장 후 최종 데이터 반환

---

## 3.2 Get User Role List

### Endpoint

```http
GET /user-roles
```

### Permission

- SUPER_ADMIN

### Query Parameters

| Name       | Required |
| ---------- | -------- |
| user_id    | N        |
| project_id | N        |
| role_code  | N        |
| status     | N        |

### Sorting

```sql
ORDER BY status DESC,
         role_code ASC,
         user_id ASC
```

---

## 3.3 Update User Role

### Endpoint

```http
PATCH /user-roles/{user_id}/{project_id}
```

### Permission

- SUPER_ADMIN

### Updatable Fields

```text
role_code
status
```

### Non-Updatable Fields

```text
user_id
project_id
```

### Business Rules

- 물리 삭제 없음 — `status = 0`으로 권한 중지
- `role_code`를 10(SUPER_ADMIN)으로 변경 불가(30003)

### Response

저장 후 최종 데이터 반환

---

## 3.4 Get My Role for Project

호출자 본인의 특정 프로젝트 역할 조회는 [11_PROJECT_API.md](./11_PROJECT_API.md) 3.1 `GET /user-roles/me?project_id=`를 따른다(관리 목적이 아니라 헤더 선택 후 화면 권한 판단용이라 전체 역할이 접근 가능 — 본 문서의 나머지 API와 권한 범위가 다르다).

---

# 4. Data Visibility Rules

## SUPER_ADMIN

모든 데이터 조회 가능

## DEVELOPER

본인 소속 `company_id`의 사용자 목록/상세 조회만 가능(1.1~1.3). 승인/반려/수정/비밀번호 초기화 및 User Role API는 접근 불가.

## MANAGER/OPERATOR

본 문서의 API 자체에 접근 권한이 없다(1장 공통 규약 참고) — 자신의 정보는 [09_AUTH_API.md](./09_AUTH_API.md) `GET /auth/me`로 조회한다.

## 중지 데이터(status=0) 조회

| Role                | status=0 조회 |
| ------------------- | ------------- |
| SUPER_ADMIN          | 가능          |
| DEVELOPER            | 가능(본인 소속 회사 범위 내) |
| MANAGER/OPERATOR     | 본 문서 API 접근 불가라 해당 없음 |
