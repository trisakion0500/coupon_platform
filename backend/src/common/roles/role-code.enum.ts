/**
 * `user_role.role_code`(10단위 권한 레벨)를 코드에서 다루기 위한 열거형.
 * 숫자가 작을수록 고권한이며 하위 권한을 누적 포함하지만(`SUPER_ADMIN ⊇ DEVELOPER ⊇
 * MANAGER ⊇ OPERATOR`), 회사/프로젝트 관리메뉴는 그 누적 구조의 예외라(CLAUDE.md 참고)
 * `RolesGuard`는 "최소 role 이상"이 아니라 이 값들의 명시적 화이트리스트로 허용 여부를 판단한다.
 *
 * @author trisakion
 */
export enum RoleCode {
  SUPER_ADMIN = 10,
  DEVELOPER = 20,
  MANAGER = 30,
  OPERATOR = 40,
}
