# 16_LAYOUT.md

# 공통 레이아웃 구조

---

# 1. 레이아웃 타입

| 타입        | 적용 Route                  | 사이드바     | 비고                             |
| ----------- | ---------------------------- | ------------ | -------------------------------- |
| AuthLayout  | `/login`, `/signup`          | 없음         | 미인증 전용, 공통 Footer만 적용  |
| MainLayout  | `/campaigns`, `/campaigns/new`, `/campaigns/:coupon_campaign_id` | 비관리 메뉴  | 기본 레이아웃                    |
| AdminLayout | `/admin/*`                   | 관리 메뉴    | MANAGER/OPERATOR 접근 불가       |

---

# 2. 공통 Header

MainLayout, AdminLayout에서 동일하게 사용한다.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  [Coupon Platform]  [회사 ▼]  [프로젝트 ▼]   [2026-07-25 15:32:10] [관리] [홍길동 ▼] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 2.1 요소별 동작

| 요소              | 동작                                                                 |
| ----------------- | ---------------------------------------------------------------------|
| 로고              | 클릭 시 쿠폰 컨트롤 홈으로 이동                                       |
| 회사 선택         | SUPER_ADMIN: 전체 회사 목록 드롭다운("전체 회사" 옵션 포함) / 그 외: 본인 회사 고정(비활성) |
| 프로젝트 선택     | 선택된 회사 기준 프로젝트 목록 / 회사 변경 시 초기화. SUPER_ADMIN만 "전체 프로젝트" 선택 가능 |
| 서버 시각(실시간, 2026-07-25 추가) | `GET /health`의 `server_time`(08_API_COMMON.md 6.1)으로 클라이언트-서버 시계 오프셋을 계산해 1초마다 로컬에서 갱신 표시(매초 폴링 아님). 5분 주기로 재동기화해 세션이 길어져도 드리프트가 누적되지 않게 한다. 캠페인 활성화가 `campaign_end > NOW()`(서버/DB 기준, 17_CAMPAIGN_API.md 2.5)로 판정되므로, 기기 시각이 아닌 실제 판정 기준을 보여주기 위함 |
| [관리] 버튼       | SUPER_ADMIN, DEVELOPER만 노출. 클릭 시 `/admin` 이동                  |
| 사용자명 드롭다운 | 내 계정(`/my-account`) / 로그아웃                                     |

회사/프로젝트 목록은 [10_COMPANY_API.md](./10_COMPANY_API.md) 3장 `GET /companies/active-header-data`로 로그인 시 1회 로드한다.

> **관리 화면 잠금**: `/admin/companies`, `/admin/projects`, `/admin/users`, `/admin/audit-logs`(목록 화면)를 제외한 나머지 관리 화면(등록/상세·수정)에서는 회사·프로젝트 선택 모두 비활성화된다 — 작업 도중 헤더 선택이 바뀌면 상세 내용과 어긋나 보여 혼란을 주기 때문. 관리 메뉴가 아닌 화면(쿠폰 컨트롤 등)은 대상 아님.

## 2.2 역할별 Header 노출

| 요소                  | SUPER_ADMIN | DEVELOPER | MANAGER | OPERATOR |
| --------------------- | :---------: | :-------: | :-----: | :------: |
| 회사 선택(드롭다운)   | O           | -(고정)   | -(고정) | -(고정)  |
| 프로젝트 선택         | O           | O         | O       | O        |
| [관리] 버튼           | O           | O         | -       | -        |

---

# 3. MainLayout

비관리 업무(쿠폰 컨트롤) 화면의 기본 레이아웃.

```
┌──────────────────────────────────────────────────────┐
│ Header                                               │
├──────────┬───────────────────────────────────────────┤
│          │                                           │
│ Sidebar  │ Content                                   │
│          │                                           │
│ 캠페인   │                                           │
│ 목록     │                                           │
│          │                                           │
├──────────┴───────────────────────────────────────────┤
│ Footer                                               │
└──────────────────────────────────────────────────────┘
```

## 3.1 Sidebar 메뉴 및 역할별 노출

| 메뉴        | Route         | SUPER_ADMIN | DEVELOPER | MANAGER | OPERATOR |
| ----------- | ------------- | :---------: | :-------: | :-----: | :------: |
| 캠페인 목록 | `/campaigns`  | O           | O         | O       | O        |

> OPERATOR가 등록하는 항목은 승인요청 상태로 전환되고, SUPER_ADMIN/DEVELOPER/MANAGER가 승인 처리한다([14_MENU_PERMISSION.md](./14_MENU_PERMISSION.md) 3.1 참고). 세부 화면 구성은 [15_SCREEN_LIST.md](./15_SCREEN_LIST.md) SCR-100~102 참고.
>
> **프로젝트 선택 필수**: `GET /campaigns`가 `project_id`를 필수로 받아 "전체 프로젝트" 조회를 지원하지 않으므로([17_CAMPAIGN_API.md](./17_CAMPAIGN_API.md) 2.2 참고), SUPER_ADMIN이 헤더에서 "전체 프로젝트"를 선택한 상태로 사이드바의 캠페인 목록을 클릭하면 화면 진입 대신 프로젝트 선택을 요구하는 안내(모달 또는 인라인 메시지)를 띄운다. 다른 관리 메뉴(회사/사용자/감사로그)는 회사 단위 스코핑이라 이 제약이 없다 — 프로젝트 단위로 스코핑되는 화면에서만 발생하는 제약이다.

> 내 계정(`/my-account`)은 사이드바가 아니라 헤더 우측 아바타 드롭다운에서 접근한다(§2.1) — 같은 화면으로 가는 진입점을 사이드바에 중복 등록하지 않기 위함.

---

# 4. AdminLayout

관리 업무 화면의 레이아웃. MANAGER/OPERATOR 접근 불가.

```
┌──────────────────────────────────────────────────────┐
│ Header                                               │
├──────────┬───────────────────────────────────────────┤
│          │                                           │
│ Sidebar  │ Content                                   │
│          │                                           │
│ 회사     │                                           │
│ 프로젝트 │                                           │
│ 사용자   │                                           │
│ 감사로그 │                                           │
│          │                                           │
├──────────┴───────────────────────────────────────────┤
│ Footer                                               │
└──────────────────────────────────────────────────────┘
```

## 4.1 Sidebar 메뉴 및 역할별 노출

| 메뉴     | Route                | SUPER_ADMIN | DEVELOPER | MANAGER | OPERATOR |
| -------- | --------------------- | :---------: | :-------: | :-----: | :------: |
| 회사     | `/admin/companies`    | O           | -         | -       | -        |
| 프로젝트 | `/admin/projects`     | O           | O         | -       | -        |
| 사용자   | `/admin/users`        | O           | O         | -       | -        |
| 감사로그 | `/admin/audit-logs`   | O           | O         | -       | -        |

> DEVELOPER는 회사 메뉴에 접근하지 못하므로 `/admin` 진입 시 `/admin/projects`로 리다이렉트한다(SUPER_ADMIN은 `/admin/companies`).

> 프로젝트 목록·사용자 목록·감사로그 목록 화면은 자체 회사 필터 콤보박스를 두지 않고, §2.1의 헤더 회사 선택을 그대로 필터 조건으로 사용한다(중복 UI 방지). SUPER_ADMIN이 헤더에서 "전체 회사"를 선택하면 세 화면 모두 전체 조회로 전환된다.

---

# 5. AuthLayout

미인증 사용자 전용. 사이드바·헤더 없이 중앙 정렬, 하단에는 MainLayout/AdminLayout과 동일한 공통 `Footer`(저작권·버전·문의처)만 적용한다 — 회사/프로젝트 선택·사용자 메뉴 등 헤더의 기능은 로그인 전 의미가 없어 제외하되, 로그인이 안 되는 사용자도 문의처는 볼 수 있어야 하므로 푸터는 재사용한다.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│               ┌──────────────────┐                  │
│               │  Coupon Platform  │                  │
│               │  로그인 / 회원가입 │                  │
│               │       폼          │                  │
│               └──────────────────┘                  │
│                                                      │
│  © 2026 Coupon Platform | v1.0.0 | 문의: ...         │
└──────────────────────────────────────────────────────┘
```

- 카드 상단 타이틀은 "로그인"/"회원가입" 문구 없이 앱 이름(`VITE_APP_NAME`)만 중앙 정렬로 표시한다.
- 인증 후 접근 시 쿠폰 컨트롤 홈으로 리다이렉트.

---

# 6. Footer

MainLayout, AdminLayout 하단 공통. 저작권 문구/버전/문의 이메일은 하드코딩이 아니라 각각 `VITE_FOOTER_COPYRIGHT`/`VITE_APP_VERSION`/`VITE_SUPPORT_EMAIL` env로 관리한다(`01_TECH_STACK.md` "Frontend 환경변수").

```
© 2026 Coupon Platform  |  v1.0.0  |  문의: trisakion@gmail.com
```

---

# 7. Route 구조

```
/login                        → AuthLayout   (미인증 전용)
/signup                       → AuthLayout   (미인증 전용)
/                             → redirect → /campaigns

/campaigns                    → MainLayout   (SCR-100 캠페인 목록)
/campaigns/new                → MainLayout   (SCR-101 캠페인 등록)
/campaigns/:coupon_campaign_id → MainLayout  (SCR-102 캠페인 상세)
/my-account                   → MainLayout

/admin                        → AdminLayout  (역할별 첫 메뉴로 redirect)
/admin/companies              → AdminLayout
/admin/companies/new          → AdminLayout
/admin/companies/:company_id  → AdminLayout
/admin/projects               → AdminLayout
/admin/projects/new           → AdminLayout
/admin/projects/:project_id   → AdminLayout
/admin/users                  → AdminLayout
/admin/users/:user_id         → AdminLayout
/admin/audit-logs             → AdminLayout
/admin/audit-logs/:idx        → AdminLayout
```

---

# 8. 라우트 가드

| 조건                                          | 처리                                                         |
| ---------------------------------------------- | -------------------------------------------------------------|
| 미인증 상태로 인증 필요 Route 접근            | `/login` 리다이렉트                                          |
| 인증 상태로 `/login`, `/signup` 접근          | `/campaigns`로 리다이렉트                                     |
| MANAGER/OPERATOR가 `/admin/*` 접근            | 403 페이지                                                    |
| `/admin` 접근 시 역할별 첫 메뉴 redirect      | SUPER_ADMIN → `/admin/companies` / DEVELOPER → `/admin/projects` |
| `selectedProjectId`가 `null`(전체 프로젝트)인 상태로 `/campaigns*`, `/coupon-use-logs` 접근 | 페이지 진입은 허용하되 목록 대신 프로젝트 선택 안내 표시(3.1 참고) — 하드 리다이렉트가 아니라 화면 내 안내인 이유는 사용자가 헤더에서 바로 프로젝트를 골라 이어서 볼 수 있게 하기 위함. `/coupon-use-logs`(SCR-103)도 `GET /coupon-use-logs`가 `project_id` 필수라(17_CAMPAIGN_API.md 4.3) `/campaigns*`와 동일한 가드가 필요(2026-07-23 추가) |

---

# 9. 전역 상태 (Zustand)

## authStore

`accessToken`/`refreshToken`/`roleCode`만 `localStorage`에 persist(`zustand/middleware`)되며, `user`는 저장하지 않고 부팅 시 `/auth/me`로 재조회한다. `isAuthenticated`라는 저장 필드는 없으며 `!!accessToken`으로 파생 계산한다(`useAuth` 훅).

| 필드          | 타입              | 설명                                          |
| ------------- | ------------------ | ---------------------------------------------- |
| user          | AuthUser \| null   | `/auth/me` 응답(원본 컬럼만, role_code 미포함) |
| accessToken   | string \| null     | JWT Access Token                               |
| refreshToken  | string \| null     | Refresh Token(UUID v4)                         |
| roleCode      | RoleCode \| null   | 로그인/재발급 응답의 role_code(세션 고정값)   |

## globalStore

| 필드               | 타입              | 설명                                                                 |
| ------------------- | ------------------ | ----------------------------------------------------------------------|
| selectedCompanyId   | number \| null    | 헤더에서 선택된 회사(null=SUPER_ADMIN의 "전체 회사")                 |
| selectedProjectId   | number \| null    | 헤더에서 선택된 프로젝트(null=SUPER_ADMIN의 "전체 프로젝트")         |
| companyList         | ActiveCompany[]   | 회사 목록 캐시(`{company_id, company_name}`, 로그인 시 1회 로드 — [10_COMPANY_API.md](./10_COMPANY_API.md) 3장) |
| projectList         | ActiveProject[]   | 프로젝트 목록 캐시(`{project_id, project_name, company_id}`, 로그인 시 1회 로드 — [10_COMPANY_API.md](./10_COMPANY_API.md) 3장) |
| projectRoleCode     | RoleCode \| null  | 선택된 프로젝트에서 호출자의 실제 role_code([11_PROJECT_API.md](./11_PROJECT_API.md) 3.1 `GET /user-roles/me`) |

---

# 10. 공통 컴포넌트

| 컴포넌트        | 설명                                                                 |
| ---------------- | ----------------------------------------------------------------------|
| RoleGuard        | 라우트 단위 role 검사, 미충족 시 403 페이지로 처리                    |
| PermissionGuard  | role 조건 충족 시만 children 렌더링(버튼 등 UI 요소 노출 제어)        |
| PageHeader       | 페이지 제목 + 우측 액션 버튼 영역                                     |
| DataTable        | Ant Design Table 래퍼 — 페이지네이션/로딩 처리, `ResizeObserver` 기반 동적 높이 산정으로 flex-column 부모 내부에서만 스크롤. 헤더 타이틀은 전역 CSS로 중앙정렬(데이터 셀은 그대로 좌측 정렬) |
| StatusBadge      | status 값을 색상 뱃지로 표시                                          |
| ConfirmModal     | 승인/반려/삭제 등 확인 모달 (예: SCR-102에서 OPERATOR가 활성 캠페인 수정 시 일시중지 경고) |
