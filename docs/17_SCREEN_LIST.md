# 17_SCREEN_LIST.md

# 화면 목록 (Screen List)

Coupon Platform 관리 콘솔 프론트엔드 화면 목록 및 역할별 접근 권한 정의.

역할 정의 및 메뉴별 접근 권한 상세는 [16_MENU_PERMISSION.md](./16_MENU_PERMISSION.md) 참고.

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
| SCR-020 | 프로젝트 목록       | `/admin/projects`                  | O           | O         | -       | -        | DEVELOPER: 역할보유(role_code<=20) 프로젝트만               |
| SCR-021 | 프로젝트 등록       | `/admin/projects/new`              | O           | -         | -       | -        |                                                             |
| SCR-022 | 프로젝트 상세·수정  | `/admin/projects/:project_id`      | O           | O         | -       | -        | 수정: SUPER_ADMIN만. Secret 재발급: SUPER_ADMIN, DEVELOPER(역할보유 프로젝트만) |
| SCR-030 | 사용자 목록         | `/admin/users`                     | O           | O         | -       | -        | 상태 콤보박스(전체/승인대기/정상/반려/사용중지) 필터; DEVELOPER: 본인 소속 회사 전체 status |
| SCR-031 | 사용자 상세·수정    | `/admin/users/:user_id`            | O           | O         | -       | -        | 수정·승인·반려·비밀번호초기화·권한관리: SUPER_ADMIN만, DEVELOPER는 조회만 |
| SCR-040 | 감사 로그 목록      | `/admin/audit-logs`                | O           | O         | -       | -        | DEVELOPER: 자사만(단 `project`/`user_role` 로그는 역할보유 프로젝트로 추가 제한) |
| SCR-041 | 감사 로그 상세      | `/admin/audit-logs/:idx`           | O           | O         | -       | -        |                                                             |
| **비관리 메뉴** |
| SCR-100 | 캠페인 목록         | `/campaigns`                       | O           | O         | O       | O        | 헤더의 전역 프로젝트 선택을 그대로 필터로 사용, "전체 프로젝트" 상태로는 진입 불가 |
| SCR-101 | 캠페인 등록         | `/campaigns/new`                   | O           | O         | O       | O        | OPERATOR: 등록 시 승인요청 상태로 전환                     |
| SCR-102 | 캠페인 상세         | `/campaigns/:coupon_campaign_id`   | O           | O         | O       | O        | 탭: 캠페인 정보 / 코드 목록 / 사용 이력 / 변경 이력. 승인·반려는 SUPER_ADMIN/DEVELOPER/MANAGER만 |
| SCR-103 | 쿠폰 사용 로그      | `/coupon-use-logs`                 | O           | O         | O       | O        | 헤더의 전역 프로젝트 선택을 그대로 필터로 사용, "전체 프로젝트" 상태로는 진입 불가(SCR-100과 동일 가드) |
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
- **접근:** SUPER_ADMIN, DEVELOPER(해당 프로젝트에서 실제 `role_code<=20`으로 활성 배정된 프로젝트만 — 13_PROJECT_API.md 2.2 참고, 회사 소속 여부·다른 프로젝트에서의 role_code와 무관)
- **주요 기능:** 프로젝트 목록 조회. 상태 필터·페이지네이션 존재, 등록 버튼(SUPER_ADMIN), 상세 이동. 헤더의 전역 회사 선택은 SUPER_ADMIN에게만 추가 필터로 적용되고(DEVELOPER는 스코핑 자체가 회사 단위가 아니라 배정 단위라 헤더 선택값을 이 화면 조회에 반영하지 않음), 화면 자체에는 회사 필터 UI가 따로 없다
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
- **접근:** SUPER_ADMIN(전체 수정), DEVELOPER(조회 + Secret 재발급, 해당 프로젝트에서 본인 role_code가 20 이하인 경우에 한함)
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
- **접근:** SUPER_ADMIN, DEVELOPER(자사만, 단 `project`/`user_role` 로그는 역할보유(role_code<=20) 프로젝트로 추가 제한 — [15_LOG_AUDIT_API.md](./15_LOG_AUDIT_API.md) 3장)
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

### SCR-100. 캠페인 목록

- **Route:** `/campaigns`
- **접근:** SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만 — [16_MENU_PERMISSION.md](./16_MENU_PERMISSION.md) 3.1 참고)
- **주요 기능:** 캠페인 목록 조회. 프로젝트 필터는 화면 자체가 아닌 헤더의 전역 프로젝트 선택을 그대로 사용(SUPER_ADMIN이 "전체 프로젝트"를 선택한 상태로는 이 화면에 진입할 수 없고, 진입 시 프로젝트를 먼저 선택하라는 안내와 함께 선택 UI로 유도한다 — `GET /campaigns`는 `project_id`가 필수라 "전체" 조회 자체를 지원하지 않음). 상태(`status`)/승인상태(`approval_status`)/생성상태(`generation_status`)/코드유형(`code_type`) 필터, 페이지네이션, 등록 버튼, 행 클릭 시 상세 이동
- **연관 API:**

  | Method | Endpoint    | 설명       |
  | ------ | ----------- | ---------- |
  | GET    | /campaigns  | 캠페인 목록 |

---

### SCR-101. 캠페인 등록

- **Route:** `/campaigns/new`
- **접근:** SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만)
- **주요 기능:** 캠페인명 / 사용기간 / 코드발급방식(RANDOM·FIXED) / 하이픈여부(RANDOM만) / 수량(RANDOM·FIXED 공통 필수 — RANDOM은 발급할 코드 개수, FIXED는 단일 코드가 지원할 총 사용가능 횟수를 의미, 2026-07-22부터 두 유형 모두 필수 입력, [19_CAMPAIGN_API.md](./19_CAMPAIGN_API.md) 2.1 참고) / 사용자당 한도 / 보상내용(JSON) 입력 및 등록. OPERATOR가 등록하면 승인대기 상태로, 그 외 역할은 즉시 승인불요로 시작. 등록 직후 상세 화면(SCR-102)으로 이동해 코드 발급을 이어서 진행하도록 안내
- **연관 API:**

  | Method | Endpoint     | 설명      |
  | ------ | ------------ | --------- |
  | POST   | /campaigns   | 캠페인 등록 |

---

### SCR-102. 캠페인 상세

- **Route:** `/campaigns/:coupon_campaign_id`
- **접근:** SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만). 승인/반려 버튼은 SUPER_ADMIN, DEVELOPER, MANAGER만 노출(OPERATOR는 자기 캠페인도 승인 불가 — [19_CAMPAIGN_API.md](./19_CAMPAIGN_API.md) 1.2 참고)
- **주요 기능:** 탭 구성 4개
  1. **캠페인 정보**: 상세 조회, 이름/사용기간/사용자당한도/보상내용/`usable_qty` 수정, 상태변경(대기→활성→일시중지→종료), 승인/반려(승인대기 상태일 때만 버튼 노출). **OPERATOR가 `status=2`(활성)이면서 `approval_status`가 3(승인완료)/4(반려)인 캠페인을 수정 저장하려 하면** 저장 직전 `ConfirmModal`로 "지금 수정하면 캠페인이 일시중지됩니다. 계속하시겠습니까?" 확인을 거친다(수정 시 재승인 부수효과 — [19_CAMPAIGN_API.md](./19_CAMPAIGN_API.md) 2.4 참고). SUPER_ADMIN/DEVELOPER/MANAGER는 이 확인 없이 즉시 저장된다(승인권한자의 수정은 재승인/일시중지 부수효과가 아예 발동하지 않으므로)
  2. **코드 목록**: RANDOM은 발급 현황(`generated_qty`/`requested_qty`, `generation_status`)과 코드 목록 페이지네이션 + 발급 요청/재시도 버튼(`generation_status`에 따라 노출 분기), FIXED는 코드 1건 등록 폼(미발급 시) 또는 등록된 코드 표시(발급 후)
  3. **사용 이력**: `game_user_id`/미컨슘 여부 필터, 페이지네이션 — [19_CAMPAIGN_API.md](./19_CAMPAIGN_API.md) 4.1 참고
  4. **변경 이력**: 작업유형(CREATE/UPDATE/STATUS_CHANGE/APPROVE/REJECT) 필터, 페이지네이션. `log_coupon_campaign`은 `log_audit`처럼 before/after 비교가 아니라 매 액션마다 그 시점 캠페인 전체 스냅샷 1행이므로, "무엇이 바뀌었는지"는 프론트가 인접한 두 행(시간순 바로 앞/뒤)을 비교해 표시한다(가장 오래된 행은 비교 대상 없이 생성 시점 상태 그대로) — [19_CAMPAIGN_API.md](./19_CAMPAIGN_API.md) 4.2 참고. 캠페인이 종료(`status=4`)돼도 계속 조회 가능(1.3 차단 대상 아님)
- **연관 API:**

  | Method | Endpoint                                   | 설명                        |
  | ------ | -------------------------------------------- | --------------------------- |
  | GET    | /campaigns/{coupon_campaign_id}             | 캠페인 상세                 |
  | PATCH  | /campaigns/{coupon_campaign_id}             | 캠페인 수정                 |
  | POST   | /campaigns/{coupon_campaign_id}/status      | 상태 변경                   |
  | POST   | /campaigns/{coupon_campaign_id}/approve     | 승인                        |
  | POST   | /campaigns/{coupon_campaign_id}/reject      | 반려                        |
  | POST   | /campaigns/{coupon_campaign_id}/codes       | 코드 발급(RANDOM 비동기/FIXED 동기) |
  | POST   | /campaigns/{coupon_campaign_id}/codes/retry | 코드 발급 재시도(RANDOM만)   |
  | GET    | /campaigns/{coupon_campaign_id}/codes       | 코드 목록                   |
  | GET    | /campaigns/{coupon_campaign_id}/usages      | 사용 이력                   |
  | GET    | /campaigns/{coupon_campaign_id}/logs        | 변경 이력                   |

---

### SCR-103. 쿠폰 사용 로그

- **Route:** `/coupon-use-logs`
- **접근:** SUPER_ADMIN, DEVELOPER, MANAGER, OPERATOR (스코핑 내 `project_id`만 — SCR-100과 동일한 헤더 전역 프로젝트 선택 가드)
- **주요 기능:** 캠페인(`coupon_campaign_id`, 선택 — SCR-102의 "변경 이력" 탭과 달리 여긴 프로젝트 전체가 기본 범위이고 특정 캠페인으로 좁히는 건 선택), 유저(`game_user_id`), 코드값(`code_value`), 작업유형(RESERVE/CONFIRM), 결과유형(`result_type`), 기간(`from_created_at`~`to_created_at`) 필터, 페이지네이션. `coupon_code_usage`(성공 건만 보존)와 달리 이 화면은 실패한 시도까지 전부 노출한다 — 코드 브루트포스·한도 우회 시도 탐지, 운영 문의 대응 목적([06_DATABASE_SCHEMA.md](./06_DATABASE_SCHEMA.md) 11장 참고). `coupon_campaign_id`가 NULL인 행(존재하지 않는 코드로 시도한 요청)은 캠페인명 없이 코드값만 표시. 캠페인 열은 값이 있는 행에 한해 SCR-102(캠페인 상세)로 링크
- **연관 API:**

  | Method | Endpoint          | 설명            |
  | ------ | ----------------- | --------------- |
  | GET    | /coupon-use-logs | 쿠폰 사용 로그 목록 |

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
