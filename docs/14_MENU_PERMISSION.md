# 14_MENU_PERMISSION.md

# 권한별 메뉴 리스트

---

# 1. 역할 정의

| Role Code | Role Name   | 설명                                       |
| --------- | ----------- | ------------------------------------------ |
| 10        | SUPER_ADMIN | 모든 회사/프로젝트/사용자/쿠폰 접근 가능   |
| 20        | DEVELOPER   | 프로젝트 기술관리(목록/상세/Secret 재발급) |
| 30        | MANAGER     | 쿠폰 도메인 즉시 컨트롤(승인 불요)         |
| 40        | OPERATOR    | 쿠폰 도메인 등록(승인요청 상태로 전환)     |

권한은 상위(숫자가 작을수록 고권한)가 하위 권한을 모두 포함하는 누적 구조다: `SUPER_ADMIN ⊇ DEVELOPER ⊇ MANAGER ⊇ OPERATOR`([10_COMPANY_API.md](./10_COMPANY_API.md) 1.2 참고).

---

# 2. 관리 메뉴

시스템 및 조직 운영에 필요한 기능. SUPER_ADMIN(일부는 DEVELOPER)만 접근한다.

## 2.1 회사 관리

| 메뉴           | SUPER_ADMIN | DEVELOPER | MANAGER | OPERATOR |
| -------------- | :---------: | :-------: | :-----: | :------: |
| 회사 목록 조회 | O           | -         | -       | -        |
| 회사 상세 조회 | O           | -         | -       | -        |
| 회사 등록      | O           | -         | -       | -        |
| 회사 수정      | O           | -         | -       | -        |

DEVELOPER의 관리메뉴 권한은 프로젝트로 한정되어 회사 관리 화면 자체에 접근하지 않는다([10_COMPANY_API.md](./10_COMPANY_API.md) 1.2 참고). MANAGER/OPERATOR도 이 화면에 접근하지 않으며, 헤더의 회사 표시·콤보박스는 별도 API([10_COMPANY_API.md](./10_COMPANY_API.md) 3장 `GET /companies/active-header-data`)로 구성한다.

---

## 2.2 프로젝트 관리

| 메뉴               | SUPER_ADMIN | DEVELOPER      | MANAGER | OPERATOR |
| ------------------ | :---------: | :------------: | :-----: | :------: |
| 프로젝트 목록 조회 | O (전체)    | O (본인 회사만) | -       | -        |
| 프로젝트 상세 조회 | O (전체)    | O (본인 회사만) | -       | -        |
| 프로젝트 등록      | O           | -              | -       | -        |
| 프로젝트 수정      | O           | -              | -       | -        |
| API Secret 재발급  | O           | O (역할보유 프로젝트만) | -  | -        |

MANAGER/OPERATOR는 이 화면에 접근하지 않는다. 헤더의 프로젝트 표시·콤보박스는 [10_COMPANY_API.md](./10_COMPANY_API.md) 3장(전 역할 허용)으로 구성한다.

---

## 2.3 사용자 관리

| 메뉴                                              | SUPER_ADMIN      | DEVELOPER                | MANAGER | OPERATOR |
| -------------------------------------------------- | :--------------: | :-----------------------: | :-----: | :------: |
| 사용자 목록 조회(상태 필터로 승인대기 포함 조회) | O (전체 status)  | O (본인 회사 전체 status) | -       | -        |
| 사용자 상세 조회                                  | O                | O (본인 회사만)           | -       | -        |
| 가입 승인                                          | O                | -                          | -       | -        |
| 가입 반려                                          | O                | -                          | -       | -        |
| 사용자 수정                                        | O                | -                          | -       | -        |
| 비밀번호 강제 초기화                              | O                | -                          | -       | -        |

---

## 2.4 사용자 권한 관리

| 메뉴          | SUPER_ADMIN | DEVELOPER | MANAGER | OPERATOR |
| ------------- | :---------: | :-------: | :-----: | :------: |
| 권한 목록 조회 | O          | -         | -       | -        |
| 권한 등록      | O          | -         | -       | -        |
| 권한 수정      | O          | -         | -       | -        |

DEVELOPER는 프로젝트 기술관리 권한만 가지므로 이 화면에는 접근하지 않는다([12_USER_API.md](./12_USER_API.md) 3장 참고).

---

## 2.5 감사 로그

| 메뉴                | SUPER_ADMIN | DEVELOPER  | MANAGER | OPERATOR |
| ------------------- | :---------: | :--------: | :-----: | :------: |
| 감사 로그 목록 조회 | O (전체)    | O (자사만) | -       | -        |
| 감사 로그 상세 조회 | O           | O          | -       | -        |

MANAGER/OPERATOR는 애초에 회사/프로젝트/사용자 관리메뉴 자체에 접근 권한이 없으므로 그 변경 이력도 조회 대상이 아니다([13_LOG_AUDIT_API.md](./13_LOG_AUDIT_API.md) 3장 참고).

---

# 3. 비관리 메뉴

Coupon Platform의 핵심 업무 기능. 역할에 따라 접근 범위가 다르다.

## 3.1 쿠폰 컨트롤

캠페인/코드/사용이력 상세 API는 [17_CAMPAIGN_API.md](./17_CAMPAIGN_API.md) 참고. 4개 role 모두 접근하되, 스코핑 기준은 동일하다 — SUPER_ADMIN은 전체, 그 외는 `user_role`에 실제 활성 배정된 `project_id`만([17_CAMPAIGN_API.md](./17_CAMPAIGN_API.md) 1.2 참고).

| 메뉴 | SUPER_ADMIN | DEVELOPER | MANAGER | OPERATOR |
| ---- | :---------: | :-------: | :-----: | :------: |
| 캠페인 목록·상세 조회 | O | O | O | O |
| 캠페인 등록·수정, 코드 발급/재시도 | O (즉시 반영) | O (즉시 반영) | O (즉시 반영) | O (승인요청 상태로 전환) |
| 캠페인 승인/반려 | O | O | O | - |
| 사용 이력 조회 | O | O | O | O |

사용 이력 조회는 등록/수정과 달리 승인 여부와 무관한 단순 조회라 4개 role 모두 동일하게 접근한다([17_CAMPAIGN_API.md](./17_CAMPAIGN_API.md) 4.1 참고).

---

## 3.2 내 계정

| 메뉴          | SUPER_ADMIN | DEVELOPER | MANAGER | OPERATOR |
| ------------- | :---------: | :-------: | :-----: | :------: |
| 내 정보 조회  | O           | O         | O       | O        |
| 비밀번호 변경 | O           | O         | O       | O        |
| 로그아웃      | O           | O         | O       | O        |

[09_AUTH_API.md](./09_AUTH_API.md) 8장/9장 참고.
