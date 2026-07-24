import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { LogAuditService } from './log-audit.service';

describe('LogAuditService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let logSpExecutor: jest.Mocked<Pick<LogSpExecutorService, 'callProcedure'>>;
  let service: LogAuditService;

  const superAdmin = {
    userId: 1,
    roleCode: RoleCode.SUPER_ADMIN,
    companyId: 1,
  };
  const developer = { userId: 10, roleCode: RoleCode.DEVELOPER, companyId: 2 };

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    logSpExecutor = { callProcedure: jest.fn() };
    // 기본값: 배정 프로젝트 목록 조회는 DEVELOPER를 다루는 테스트에서만 의미가 있고,
    // SUPER_ADMIN 경로는 이 SP를 아예 호출하지 않는다.
    spExecutor.callProcedure.mockResolvedValue({
      result: 0,
      data: [{ project_ids: '5,6' }],
    });
    service = new LogAuditService(
      spExecutor as unknown as SpExecutorService,
      logSpExecutor as unknown as LogSpExecutorService,
    );
  });

  describe('list', () => {
    const query = { page: 1, page_size: 20 };
    const row = {
      idx: 1001,
      company_id: 1,
      project_id: null,
      table_name: 'user',
      target_id: '3',
      target_name: 'Manager',
      action: 30,
      created_by: 1,
      created_by_name: 'Super Admin',
      created_at: '2026-07-16 10:00:00',
      total_count: 1,
    };

    it('passes company_id as-is for SUPER_ADMIN when provided', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [row],
      });

      await service.list({ ...query, company_id: 5 }, superAdmin);

      expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_LOG_AUDIT_LIST',
        [5, null, null, null, null, null, null, 20, 0, null],
      );
    });

    it('never resolves developer project ids for SUPER_ADMIN', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [row],
      });

      await service.list({ ...query, company_id: 5 }, superAdmin);

      expect(spExecutor.callProcedure).not.toHaveBeenCalled();
    });

    it('passes null company_id for SUPER_ADMIN when omitted (full scope)', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [row],
      });

      await service.list(query, superAdmin);

      expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_LOG_AUDIT_LIST',
        [null, null, null, null, null, null, null, 20, 0, null],
      );
    });

    it('forces DEVELOPER company_id regardless of the query value', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [row],
      });

      await service.list({ ...query, company_id: 999 }, developer);

      expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_LOG_AUDIT_LIST',
        [2, null, null, null, null, null, null, 20, 0, '5,6'],
      );
    });

    it('resolves DEVELOPER project ids via SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS using their own user id', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [row],
      });

      await service.list(query, developer);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS',
        [developer.userId],
      );
    });

    it('passes an empty string (not null) when a DEVELOPER has no assigned projects', async () => {
      spExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ project_ids: null }],
      });
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [row],
      });

      await service.list(query, developer);

      expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_LOG_AUDIT_LIST',
        [2, null, null, null, null, null, null, 20, 0, ''],
      );
    });

    it('filters out the NULL-idx sentinel row and returns total_count', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [row],
      });

      const result = await service.list(query, superAdmin);

      expect(result.total_count).toBe(1);
      expect(result.items).toEqual([
        {
          idx: 1001,
          company_id: 1,
          project_id: null,
          table_name: 'user',
          target_id: '3',
          target_name: 'Manager',
          action: 30,
          created_by: 1,
          created_by_name: 'Super Admin',
          created_at: '2026-07-16 10:00:00',
        },
      ]);
    });

    it('returns an empty page (total_count preserved) when the offset row has NULL idx', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ ...row, idx: null, total_count: 5 }],
      });

      const result = await service.list(
        { page: 10, page_size: 20 },
        superAdmin,
      );

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

  describe('getById', () => {
    const detailRow = {
      idx: 1001,
      company_id: 1,
      project_id: null,
      table_name: 'user',
      target_id: '3',
      target_name: 'Manager',
      action: 30,
      before_json: '{"status":0}',
      after_json: '{"status":1}',
      created_by: 1,
      created_by_name: 'Super Admin',
      created_at: '2026-07-16 10:00:00',
    };

    it('parses before_json/after_json from LONGTEXT strings into objects', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [detailRow],
      });

      const result = await service.getById(1001, superAdmin);

      expect(result.before_json).toEqual({ status: 0 });
      expect(result.after_json).toEqual({ status: 1 });
    });

    it('leaves before_json as null for CREATE entries', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ ...detailRow, before_json: null }],
      });

      const result = await service.getById(1001, superAdmin);

      expect(result.before_json).toBeNull();
    });

    it('allows DEVELOPER to view a log entry within their own company', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ ...detailRow, company_id: 2 }],
      });

      await expect(service.getById(1001, developer)).resolves.toMatchObject({
        company_id: 2,
      });
    });

    it('rejects DEVELOPER viewing a log entry from another company', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ ...detailRow, company_id: 999 }],
      });

      await expect(service.getById(1001, developer)).rejects.toThrow(
        new BusinessException(ResultCode.PERMISSION_DENIED),
      );
    });

    it('allows DEVELOPER to view a project-table log entry within an assigned project', async () => {
      spExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ project_ids: '5,6' }],
      });
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [
          { ...detailRow, company_id: 2, table_name: 'project', project_id: 6 },
        ],
      });

      await expect(service.getById(1001, developer)).resolves.toMatchObject({
        project_id: 6,
      });
    });

    it('rejects DEVELOPER viewing a project-table log entry outside their assigned projects', async () => {
      spExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ project_ids: '5,6' }],
      });
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [
          {
            ...detailRow,
            company_id: 2,
            table_name: 'project',
            project_id: 999,
          },
        ],
      });

      await expect(service.getById(1001, developer)).rejects.toThrow(
        new BusinessException(ResultCode.PERMISSION_DENIED),
      );
    });

    it('rejects DEVELOPER viewing a user_role-table log entry when they have no assigned projects', async () => {
      spExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ project_ids: null }],
      });
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [
          {
            ...detailRow,
            company_id: 2,
            table_name: 'user_role',
            project_id: 6,
          },
        ],
      });

      await expect(service.getById(1001, developer)).rejects.toThrow(
        new BusinessException(ResultCode.PERMISSION_DENIED),
      );
    });

    it('does not additionally scope company/user table entries by project for DEVELOPER', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [
          {
            ...detailRow,
            company_id: 2,
            table_name: 'company',
            project_id: null,
          },
        ],
      });

      await service.getById(1001, developer);

      expect(spExecutor.callProcedure).not.toHaveBeenCalled();
    });

    it('allows SUPER_ADMIN to view any project-table log entry without resolving project ids', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ ...detailRow, table_name: 'project', project_id: 999 }],
      });

      await expect(service.getById(1001, superAdmin)).resolves.toMatchObject({
        project_id: 999,
      });
      expect(spExecutor.callProcedure).not.toHaveBeenCalled();
    });

    it('throws LOG_AUDIT_NOT_FOUND when RESULT=31008', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({ result: 31008 });

      await expect(service.getById(9999, superAdmin)).rejects.toThrow(
        new BusinessException(ResultCode.LOG_AUDIT_NOT_FOUND),
      );
    });

    it('throws INTERNAL_ERROR on unexpected SP result', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({ result: 50001 });

      await expect(service.getById(1001, superAdmin)).rejects.toThrow(
        new BusinessException(ResultCode.INTERNAL_ERROR),
      );
    });
  });
});
