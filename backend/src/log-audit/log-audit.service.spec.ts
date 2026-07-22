import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { LogAuditService } from './log-audit.service';

describe('LogAuditService', () => {
  let logSpExecutor: jest.Mocked<Pick<LogSpExecutorService, 'callProcedure'>>;
  let service: LogAuditService;

  const superAdmin = { roleCode: RoleCode.SUPER_ADMIN, companyId: 1 };
  const developer = { roleCode: RoleCode.DEVELOPER, companyId: 2 };

  beforeEach(() => {
    logSpExecutor = { callProcedure: jest.fn() };
    service = new LogAuditService(
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
        [5, null, null, null, null, null, null, 20, 0],
      );
    });

    it('passes null company_id for SUPER_ADMIN when omitted (full scope)', async () => {
      logSpExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [row],
      });

      await service.list(query, superAdmin);

      expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_LOG_AUDIT_LIST',
        [null, null, null, null, null, null, null, 20, 0],
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
        [2, null, null, null, null, null, null, 20, 0],
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

      await expect(
        service.getById(1001, developer),
      ).resolves.toMatchObject({ company_id: 2 });
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
