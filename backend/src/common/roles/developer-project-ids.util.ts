import { SpExecutorService } from '../database/sp-executor.service';
import { BusinessException } from '../response/business.exception';
import { ResultCode } from '../response/result-code.enum';

/**
 * `SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS`(메인 DB)로 호출자가 role_code<=20(DEVELOPER 이상)
 * 으로 배정된 프로젝트 ID 콤마 문자열을 조회한다. 배정이 하나도 없으면 GROUP_CONCAT이 NULL을
 * 반환하므로 빈 문자열로 정규화한다 - "제한 없음"(SUPER_ADMIN이 넘기는 실제 NULL)과 혼동되지
 * 않도록 호출부가 항상 빈 문자열/콤마 목록 둘 중 하나만 받게 한다.
 *
 * `log-audit`(project/user_role 테이블 로그 추가 스코핑)과 `log-rate-limit`(모든 행이 프로젝트
 * 단위 이벤트라 항상 적용) 두 서비스가 동일한 로직을 필요로 해 공용 함수로 뽑았다.
 */
export async function resolveDeveloperProjectIds(
  spExecutor: SpExecutorService,
  userId: number,
): Promise<string> {
  const { result, data } = await spExecutor.callProcedure<
    Array<{ project_ids: string | null }>
  >('SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS', [userId]);

  if (result !== 0) {
    throw new BusinessException(ResultCode.INTERNAL_ERROR);
  }

  return data?.[0]?.project_ids ?? '';
}
