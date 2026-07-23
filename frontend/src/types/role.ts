/**
 * `user_role.role_code`(10단위 권한 레벨). 숫자가 작을수록 고권한이며 하위 권한을 누적
 * 포함하지만(SUPER_ADMIN ⊇ DEVELOPER ⊇ MANAGER ⊇ OPERATOR), 회사/프로젝트 관리메뉴는 그
 * 누적 구조의 예외다 — 화이트리스트 방식으로 접근을 판단해야 한다(백엔드
 * `backend/src/common/roles/role-code.enum.ts`와 값 동일).
 *
 * `const` 객체 + `typeof` 타입으로 선언한 이유는 이 프로젝트 tsconfig의
 * `erasableSyntaxOnly`(TS enum처럼 런타임 코드를 발생시키는 문법을 금지) 제약 때문 —
 * `RoleCode.SUPER_ADMIN` 값 접근과 `RoleCode` 타입 참조를 기존 enum과 동일한 문법으로
 * 그대로 쓸 수 있다.
 */
export const RoleCode = {
  SUPER_ADMIN: 10,
  DEVELOPER: 20,
  MANAGER: 30,
  OPERATOR: 40,
} as const;

export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];
