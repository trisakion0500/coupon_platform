# 01_TECH_STACK.md

## Backend

| 항목            | 결정                                                       |
| --------------- | ---------------------------------------------------------- |
| Runtime         | Node.js 22 LTS                                              |
| Framework       | NestJS                                                      |
| Language        | TypeScript                                                  |
| Database        | MySQL 8.4                                                   |
| Data Access     | mysql2 — Stored Procedure / Function 전용 (Native SQL 직접 작성 금지) |
| Authentication  | JWT (HS256) + user_session (사용자 인증)                    |
| S2S Authentication | API Key + Secret(SHA-256 해시) — 게임서버 → 쿠폰서버, grace period 방식 재발급 |
| Password Hash   | bcrypt (rounds=12)                                          |
| API Style       | REST + JSON                                                 |
| Logging         | log_audit (감사 로그) + application log (log4js)            |
| S2S Call        | HTTP/HTTPS POST (JSON Payload)                              |

---

## Frontend

| 항목          | 결정                  |
| ------------- | --------------------- |
| Framework     | React 18 + TypeScript |
| Build         | Vite                  |
| UI 컴포넌트   | Ant Design (antd)     |
| 폼 상태 관리  | Ant Design Form (antd `Form`, 일부 컴포넌트는 react-hook-form) |
| 상태 관리     | Zustand               |
| HTTP          | Axios                 |

---

## 환경변수 관리 항목

```text
NODE_ENV
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
JWT_SECRET
JWT_ACCESS_EXPIRES_IN
JWT_REFRESH_EXPIRES_IN
ENCRYPTION_KEY
API_SECRET_GRACE_PERIOD_DAYS
CORS_ALLOWED_ORIGINS
PORT
LOG_DEBUG_ERRORS
SWAGGER_ENABLED
API_EXECUTION_TIMEOUT_MS
LOGIN_RATE_LIMIT_WINDOW_MS
LOGIN_RATE_LIMIT_MAX
SESSION_CLEANUP_CRON
```
