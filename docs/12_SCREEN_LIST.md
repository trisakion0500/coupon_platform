# 12_SCREEN_LIST.md

# 화면 목록 (Screen List)

Coupon Platform 관리 콘솔 프론트엔드 화면 목록 및 역할별 접근 권한 정의.

역할 정의 및 메뉴별 접근 권한 상세는 [11_MENU_PERMISSION.md](./11_MENU_PERMISSION.md) 참고.

---

# 1. 전체 화면 목록

| ID      | 화면명             | Route                             | SUPER_ADMIN | DEVELOPER | MANAGER | OPERATOR | 비고                                                     |
| ------- | ------------------- | ---------------------------------- | :---------: | :-------: | :-----: | :------: | --------------------------------------------------------- |
| **인증** |
| SCR-001 | 로그인              | `/login`                           | O           | O         | O       | O        | 미인증 전용                                                |
| SCR-002 | 회원가입            | `/signup`                          | O           | O         | O       | O        | 미인증 전용                                                |
| **관리 메뉴** |
| SCR-010 | 회사 목록           | `/admin/companies`                 | O           | -         | -       | -        |                                                             |
| SCR-011 | 회사 등록           | `/admin/companies/new`             | O           | -         | -       | -        |                                                             |
| SCR-012 | 회사 상세·수정      | `/admin/companies/:company_id`     | O           | -         | -       | -        |                                                             |
| SCR-020 | 프로젝트 목록       | `/admin/projects`                  | O           | O         | -       | -        | DEVELOPER: 본인 소속 회사만                                |
| SCR-021 | 프로젝트 등록       | `/admin/projects/new`              | O           | -         | -       | -        |                                                             |
| SCR-022 | 프로젝트 상세·수정  | `/admin/projects/:project_id`      | O           | O         | -       | -        | 수정: SUPER_ADMIN만. Secret 재발급: SUPER_ADMIN, DEVELOPER(역할보유 프로젝트만) |
| SCR-030 | 사용자 목록         | `/admin/users`                     | O           | O         | -       | -        | 상태 콤보박스(전체/승인대기/정상/반려/사용중지) 필터; DEVELOPER: 본인 소속 회사 전체 status |
| SCR-031 | 사용자 상세·수정    | `/admin/users/:user_id`            | O           | O         | -       | -        | 수정·승인·반려·비밀번호초기화·권한관리: SUPER_ADMIN만, DEVELOPER는 조회만 |
| SCR-040 | 감사 로그 목록      | `/admin/audit-logs`                | O           | O         | -       | -        | SUPER_ADMIN 외: 자사만                                     |
| SCR-041 | 감사 로그 상세      | `/admin/audit-logs/:idx`           | O           | O         | -       | -        |                                                             |
| **비관리 메뉴** |
| SCR-100 | 쿠폰 컨트롤         | *(쿠폰 도메인 설계 후 정의)*       | O           | O         | O       | O        | OPERATOR: 등록 시 승인요청 상태로 전환. 세부 화면은 캠페인/코드 설계 완료 후 추가 |
| **내 계정** |
| SCR-200 | 내 계정             | `/my-account`                      | O           | O         | O       | O        | 내 정보 조회 + 비밀번호 변경 + 로그아웃                    |

---

# 2. 화면 상세

## 2.1 인증

### SCR-001. 로그인

- **Route:** `/login`
- **접근:** 미인증 사용자 (로그인 후 자동 리다이렉트)
- **주요 기능:** 로그인 ID / 비밀번호 입력, 상태별 오류 메시지 표시(승인대기/반려/사용중지)
- **연관 API:**

  | Method | Endpoint      | 설명                       |
  | ------ | ------------- | -------------------------- |
  | POST   | /auth/login   | 로그인 및 토큰 발급        |
  | POST   | /auth/refresh | Access Token 재발급(자동)  |

---

### SCR-002. 회원가입

- **Route:** `/signup`
- **접근:** 미인증 사용자
- **주요 기능:** 회사코드 / 프로젝트코드(선택) 직접 입력("담당자에게 문의하여 코드를 받아 입력하세요" 안내), 로그인 ID / 이름 / 이메일 / 휴대폰번호 / 부서(선택) / 직급(선택) / 비밀번호 입력, 가입 후 승인 대기 안내. 회사/프로젝트 목록 드롭다운이 아니라 코드 텍스트 입력인 이유는 `GET /companies`/`GET /projects`가 인증 필수라 로그인 전 화면에서 못 쓰기 때문. 코드 검증은 입력 중이 아닌 제출 시점에만 수행.
- **연관 API:**

  | Method | Endpoint            | 설명                                            |
  | ------ | ------------------- | ------------------------------------------------ |
  | GET    | /companies/lookup   | 회사코드로 활성 회사 조회(인증 불필요)          |
  | GET    | /projects/lookup    | 프로젝트코드로 활성 프로젝트 조회(인증 불필요)  |
  | POST   | /auth/signup        | 회원가입                                         |

---

## 2.2 관리 메뉴

### SCR-010. 회사 목록

- **Route:** `/admin/companies`
- **접근:** SUPER_ADMIN
- **주요 기능:** 회사 목록 조회(상태 필터, 페이지네이션), 등록 버튼, 상세 이동
- **연관 API:**

  | Method | Endpoint   | 설명      |
  | ------ | ---------- | --------- |
  | GET    | /companies | 회사 목록 |

---

### SCR-011. 회사 등록

- **Route:** `/admin/companies/new`
- **접근:** SUPER_ADMIN
- **주요 기능:** 회사 코드 / 이름 / 설명 입력 및 등록
- **연관 API:**

  | Method | Endpoint   | 설명      |
  | ------ | ---------- | --------- |
  | POST   | /companies | 회사 등록 |

---

### SCR-012. 회사 상세·수정

- **Route:** `/admin/companies/:company_id`
- **접근:** SUPER_ADMIN
- **주요 기능:** 회사 정보 조회, 코드 / 이름 / 설명 / 상태 수정
- **연관 API:**

  | Method | Endpoint                | 설명      |
  | ------ | ----------------------- | --------- |
  | GET    | /companies/{company_id} | 회사 상세 |
  | PATCH  | /companies/{company_id} | 회사 수정 |

---

### SCR-020. 프로젝트 목록

- **Route:** `/admin/projects`
- **접근:** SUPER_ADMIN, DEVELOPER(본인 소속 회사만)
- **주요 기능:** 프로젝트 목록 조회. 회사 필터는 화면 자체가 아닌 헤더의 전역 회사 선택 콤보박스를 그대로 사용(SUPER_ADMIN만 "전체 회사" 선택 가능, DEVELOPER는 본인 소속 회사로 고정), 화면에는 상태 필터·페이지네이션만 존재. 등록 버튼(SUPER_ADMIN), 상세 이동
- **연관 API:**

  | Method | Endpoint  | 설명          |
  | ------ | --------- | ------------- |
  | GET    | /projects | 프로젝트 목록 |

---

### SCR-021. 프로젝트 등록

- **Route:** `/admin/projects/new`
- **접근:** SUPER_ADMIN
- **주요 기능:** 회사 선택, 프로젝트 코드 / 이름 / 설명 입력 및 등록. 등록 성공 시 서버가 즉시 발급한 `api_key`/`api_secret`을 모달로 1회 노출(평문 `api_secret`은 재조회 불가 안내)
- **연관 API:**

  | Method | Endpoint   | 설명               |
  | ------ | ---------- | ------------------ |
  | GET    | /companies | 회사 선택 목록     |
  | POST   | /projects  | 프로젝트 등록(api_key/api_secret 즉시 발급) |

---

### SCR-022. 프로젝트 상세·수정

- **Route:** `/admin/projects/:project_id`
- **접근:** SUPER_ADMIN(전체 수정), DEVELOPER(조회 + Secret 재발급, 본인이 역할보유한 프로젝트에 한함)
- **주요 기능:** 프로젝트 정보 조회, 이름 / 설명 / 상태 수정(SUPER_ADMIN), API Secret 재발급(SUPER_ADMIN, DEVELOPER — 재발급 응답에만 평문이 1회 노출되는 모달, 이후 조회는 `secret_rotated_at`만 표시). `company_id`/`project_code`/`api_key`는 표시만(수정 불가)
- **연관 API:**

  | Method | Endpoint                          | 설명                          |
  | ------ | ---------------------------------- | ----------------------------- |
  | GET    | /projects/{project_id}            | 프로젝트 상세                 |
  | PATCH  | /projects/{project_id}            | 프로젝트 수정(SUPER_ADMIN)   |
  | POST   | /projects/{project_id}/api-secret/rotate | API Secret 재발급(SUPER_ADMIN, DEVELOPER) |

---

### SCR-030. 사용자 목록

- **Route:** `/admin/users`
- **접근:** SUPER_ADMIN, DEVELOPER(본인 소속 회사 전체 status 조회 가능)
- **주요 기능:** 사용자 목록 조회. 회사 필터는 화면 자체가 아닌 헤더의 전역 회사 선택 콤보박스를 그대로 사용, 화면에는 상태 콤보박스(전체/승인대기/정상/반려/사용중지) 필터·페이지네이션만 존재, 상세 이동
- **연관 API:**

  | Method | Endpoint | 설명                                        |
  | ------ | -------- | -------------------------------------------- |
  | GET    | /users   | 사용자 목록(company_id·status 파라미터로 필터링) |

---

### SCR-031. 사용자 상세·수정

- **Route:** `/admin/users/:user_id`
- **접근:** SUPER_ADMIN(수정·승인·반려·권한관리), DEVELOPER(조회만)
- **주요 기능:** 사용자 정보 조회, 이름 / 이메일 / 휴대폰번호 / 부서 / 직급 / 상태 수정, 가입 승인 / 반려, 비밀번호 강제 초기화, User Role 등록·수정(모두 SUPER_ADMIN만)
- **연관 API:**

  | Method | Endpoint                            | 설명                 |
  | ------ | ------------------------------------ | -------------------- |
  | GET    | /users/{user_id}                    | 사용자 상세          |
  | PATCH  | /users/{user_id}                    | 사용자 수정          |
  | POST   | /users/{user_id}/approve            | 가입 승인            |
  | POST   | /users/{user_id}/reject             | 가입 반려            |
  | POST   | /users/{user_id}/reset-password     | 비밀번호 강제 초기화 |
  | GET    | /user-roles                         | 권한 목록            |
  | POST   | /user-roles                         | 권한 등록            |
  | PATCH  | /user-roles/{user_id}/{project_id}  | 권한 수정            |

---

### SCR-040. 감사 로그 목록

- **Route:** `/admin/audit-logs`
- **접근:** SUPER_ADMIN, DEVELOPER(SUPER_ADMIN 외: 자사만)
- **주요 기능:** 감사 로그 목록 조회. 회사 필터는 화면 자체가 아닌 헤더의 전역 회사 선택을 그대로 사용(SUPER_ADMIN만 "전체" 선택 가능), 화면에는 테이블 / 작업 유형 / 기간 필터·페이지네이션 존재(작업자 필터는 없음 — 대신 목록·상세 모두 회사/프로젝트를 원시 ID가 아닌 이름으로 표시), 상세 이동
- **연관 API:**

  | Method | Endpoint    | 설명           |
  | ------ | ----------- | -------------- |
  | GET    | /log-audits | 감사 로그 목록 |

---

### SCR-041. 감사 로그 상세

- **Route:** `/admin/audit-logs/:idx`
- **접근:** SUPER_ADMIN, DEVELOPER
- **주요 기능:** before_json / after_json 비교 조회, 작업 유형(CREATE / UPDATE / STATUS_CHANGE) 확인
- **연관 API:**

  | Method | Endpoint          | 설명           |
  | ------ | ------------------ | -------------- |
  | GET    | /log-audits/{idx} | 감사 로그 상세 |

---

## 2.3 비관리 메뉴

### SCR-100. 쿠폰 컨트롤

- **Route:** 미정
- **접근:** SUPER_ADMIN, DEVELOPER, MANAGER(즉시 반영), OPERATOR(등록 시 승인요청 상태로 전환)
- **주요 기능:** 쿠폰 도메인(캠페인/코드/사용이력) 설계 완료 후 정의. 현재는 [11_MENU_PERMISSION.md](./11_MENU_PERMISSION.md) 3.1의 원칙만 확정된 상태.

---

## 2.4 내 계정

### SCR-200. 내 계정

- **Route:** `/my-account`
- **접근:** SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR
- **주요 기능:** 내 정보 조회(이름 / 이메일 / 소속 회사 / 최근 로그인), 비밀번호 변경, 로그아웃
- **연관 API:**

  | Method | Endpoint       | 설명          |
  | ------ | -------------- | ------------- |
  | GET    | /auth/me       | 내 정보 조회  |
  | PATCH  | /auth/password | 비밀번호 변경 |
  | POST   | /auth/logout   | 로그아웃      |
