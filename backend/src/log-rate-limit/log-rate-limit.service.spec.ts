import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { LogRateLimitService } from './log-rate-limit.service';

describe('LogRateLimitService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let logSpExecutor: jest.Mocked<Pick<LogSpExecutorService, 'callProcedure'>>;
  let service: LogRateLimitService;

  const superAdmin = {
    userId: 1,
    roleCode: RoleCode.SUPER_ADMIN,
    companyId: 1,
  };
  const developer = { userId: 10, roleCode: RoleCode.DEVELOPER, companyId: 2 };

  const row = {
    idx: 501,
    limit_scope: 10,
    action: 10,
    api_key: 'abcd1234',
    project_id: 1,
    company_id: 1,
    game_user_id: null,
    retry_after_sec: 30,
    caller_ip: '127.0.0.1',
    created_at: '2026-08-06 10:00:00',
    total_count: 1,
  };

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    logSpExecutor = { callProcedure: jest.fn() };
    // 기본값: 배정 프로젝트 목록 조회는 DEVELOPER를 다루는 테스트에서만 의미가 있고,
    // SUPER_ADMIN 경로는 이 SP를 아예 호출하지 않는다.
    spExecutor.callProcedure.mockResolvedValue({
      result: 0,
      data: [{ project_ids: '5,6' }],
    });
    service = new LogRateLimitService(
      spExecutor as unknown as SpExecutorService,
      logSpExecutor as unknown as LogSpExecutorService,
    );
  });

  const query = { page: 1, page_size: 20 };

  it('passes company_id as-is for SUPER_ADMIN when provided', async () => {
    logSpExecutor.callProcedure.mockResolvedValue({ result: 0, data: [row] });

    await service.list({ ...query, company_id: 5 }, superAdmin);

    expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
      'SP_LOG_COUPON_RATE_LIMIT_LIST',
      [5, null, null, null, null, null, null, 20, 0, null],
    );
  });

  it('never resolves developer project ids for SUPER_ADMIN', async () => {
    logSpExecutor.callProcedure.mockResolvedValue({ result: 0, data: [row] });

    await service.list(query, superAdmin);

    expect(spExecutor.callProcedure).not.toHaveBeenCalled();
  });

  it('forces DEVELOPER company_id regardless of the query value and resolves project ids', async () => {
    logSpExecutor.callProcedure.mockResolvedValue({ result: 0, data: [row] });

    await service.list({ ...query, company_id: 999 }, developer);

    expect(spExecutor.callProcedure).toHaveBeenCalledWith(
      'SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS',
      [developer.userId],
    );
    expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
      'SP_LOG_COUPON_RATE_LIMIT_LIST',
      [2, null, null, null, null, null, null, 20, 0, '5,6'],
    );
  });

  it('passes an empty string (not null) when a DEVELOPER has no assigned projects', async () => {
    spExecutor.callProcedure.mockResolvedValue({
      result: 0,
      data: [{ project_ids: null }],
    });
    logSpExecutor.callProcedure.mockResolvedValue({ result: 0, data: [row] });

    await service.list(query, developer);

    expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
      'SP_LOG_COUPON_RATE_LIMIT_LIST',
      [2, null, null, null, null, null, null, 20, 0, ''],
    );
  });

  it('passes through limit_scope/action/game_user_id/period filters', async () => {
    logSpExecutor.callProcedure.mockResolvedValue({ result: 0, data: [row] });

    await service.list(
      {
        ...query,
        project_id: 3,
        limit_scope: 20,
        action: 20,
        game_user_id: 'user-1',
        from_created_at: '2026-08-01 00:00:00',
        to_created_at: '2026-08-31 23:59:59',
      },
      superAdmin,
    );

    expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
      'SP_LOG_COUPON_RATE_LIMIT_LIST',
      [
        null,
        3,
        20,
        20,
        'user-1',
        '2026-08-01 00:00:00',
        '2026-08-31 23:59:59',
        20,
        0,
        null,
      ],
    );
  });

  it('filters out the NULL-idx sentinel row and returns total_count', async () => {
    logSpExecutor.callProcedure.mockResolvedValue({ result: 0, data: [row] });

    const result = await service.list(query, superAdmin);

    expect(result.total_count).toBe(1);
    expect(result.items).toEqual([
      {
        idx: 501,
        limit_scope: 10,
        action: 10,
        api_key: 'abcd1234',
        project_id: 1,
        company_id: 1,
        game_user_id: null,
        retry_after_sec: 30,
        caller_ip: '127.0.0.1',
        created_at: '2026-08-06 10:00:00',
      },
    ]);
  });

  it('returns an empty page (total_count preserved) when the offset row has NULL idx', async () => {
    logSpExecutor.callProcedure.mockResolvedValue({
      result: 0,
      data: [{ ...row, idx: null, total_count: 5 }],
    });

    const result = await service.list({ page: 10, page_size: 20 }, superAdmin);

    expect(result.total_count).toBe(5);
    expect(result.items).toEqual([]);
  });

  it('throws INTERNAL_ERROR on unexpected SP result', async () => {
    logSpExecutor.callProcedure.mockResolvedValue({ result: 50001 });

    await expect(service.list(query, superAdmin)).rejects.toThrow(
      new BusinessException(ResultCode.INTERNAL_ERROR),
    );
  });
});
