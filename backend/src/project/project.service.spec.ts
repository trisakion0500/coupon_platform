import { AuditLogService } from '../common/audit-log/audit-log.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { ProjectIdentityCacheService } from '../common/project-identity-cache/project-identity-cache.service';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let crypto: jest.Mocked<Pick<CryptoService, 'encrypt'>>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let projectIdentityCache: jest.Mocked<
    Pick<ProjectIdentityCacheService, 'cacheIdentity'>
  >;
  let service: ProjectService;

  const projectRow = {
    project_id: 10,
    company_id: 1,
    company_code: 'GAB',
    company_name: 'Game Company A',
    project_code: 'GAB_RPG',
    project_name: 'RPG Project',
    api_key: 'a'.repeat(64),
    description: null,
    status: 1,
    secret_rotated_at: null,
    created_at: '2026-07-19 10:00:00',
    updated_at: '2026-07-19 10:00:00',
    edit_count: 0,
  };

  const superAdmin = {
    userId: 1,
    roleCode: RoleCode.SUPER_ADMIN,
    companyId: 1,
  };
  const developer = { userId: 2, roleCode: RoleCode.DEVELOPER, companyId: 2 };

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    crypto = { encrypt: jest.fn((plain: string) => `enc(${plain})`) };
    auditLog = { record: jest.fn() };
    projectIdentityCache = {
      cacheIdentity: jest.fn().mockResolvedValue(undefined),
    };
    service = new ProjectService(
      spExecutor as unknown as SpExecutorService,
      crypto as unknown as CryptoService,
      auditLog as unknown as AuditLogService,
      projectIdentityCache as unknown as ProjectIdentityCacheService,
    );
  });

  describe('create', () => {
    const dto = {
      company_id: 1,
      project_code: 'GAB_RPG',
      project_name: 'RPG Project',
    };

    it('returns the created project with a plaintext api_secret', async () => {
      const createdRow = {
        project_id: 10,
        company_id: 1,
        project_code: 'GAB_RPG',
        project_name: 'RPG Project',
        description: null,
        api_key: 'a'.repeat(64),
        status: 1,
        created_at: '2026-07-19 10:00:00',
        updated_at: '2026-07-19 10:00:00',
      };
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [createdRow],
      });

      const result = await service.create(dto, 1);

      expect(result).toMatchObject(createdRow);
      expect(result.api_secret).toEqual(expect.any(String));
      expect(result.api_secret).toHaveLength(64);
    });

    it('throws COMPANY_NOT_FOUND on 31001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31001 });
      await expect(service.create(dto, 1)).rejects.toMatchObject({
        resultCode: ResultCode.COMPANY_NOT_FOUND,
      });
    });

    it('throws DUPLICATE_DATA on 32001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 32001 });
      await expect(service.create(dto, 1)).rejects.toMatchObject({
        resultCode: ResultCode.DUPLICATE_DATA,
      });
    });

    it('propagates DATABASE_ERROR when the SP call throws it', async () => {
      spExecutor.callProcedure.mockRejectedValueOnce(
        new BusinessException(ResultCode.DATABASE_ERROR),
      );
      await expect(service.create(dto, 1)).rejects.toMatchObject({
        resultCode: ResultCode.DATABASE_ERROR,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.create(dto, 2)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });
  });

  describe('list', () => {
    // 2026-07-24 — DEVELOPER 스코핑이 회사 단위에서 실제 user_role 배정 단위로 바뀌어(SP가
    // 행 단위로 필터링), 앱 레이어는 더 이상 company_id를 강제로 채우지 않는다 — role과
    // 무관하게 query.company_id를 순수 필터로 그대로 전달한다.
    it('passes query.company_id through unchanged regardless of role', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0, data: [] });

      await service.list({ page: 1, page_size: 20 }, developer);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith('SP_PROJECT_LIST', [
        null,
        null,
        20,
        0,
        developer.userId,
      ]);
    });

    it('passes the query company_id through for SUPER_ADMIN', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0, data: [] });

      await service.list({ page: 1, page_size: 20, company_id: 5 }, superAdmin);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith('SP_PROJECT_LIST', [
        5,
        null,
        20,
        0,
        superAdmin.userId,
      ]);
    });

    it('strips total_count and builds a paginated result', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...projectRow, total_count: 1 }],
      });

      const result = await service.list({ page: 1, page_size: 20 }, superAdmin);

      expect(result).toEqual({
        page: 1,
        page_size: 20,
        total_count: 1,
        items: [projectRow],
      });
    });

    it('reports the real total_count when the requested page is out of range', async () => {
      // SP_PROJECT_LIST가 offset이 실제 데이터 범위를 벗어나면 project_id 등 데이터 컬럼이
      // 전부 NULL인 채로 total_count만 채운 행 1개를 반환한다(LEFT JOIN ... ON TRUE) — 그 행은
      // items에서 제외돼야 하지만 total_count는 실제 값을 반영해야 한다.
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            project_id: null,
            company_id: null,
            company_code: null,
            company_name: null,
            project_code: null,
            project_name: null,
            api_key: null,
            description: null,
            status: null,
            secret_rotated_at: null,
            created_at: null,
            updated_at: null,
            total_count: 3,
          },
        ],
      });

      const result = await service.list({ page: 2, page_size: 20 }, superAdmin);

      expect(result).toEqual({
        page: 2,
        page_size: 20,
        total_count: 3,
        items: [],
      });
    });
  });

  describe('getById', () => {
    it('returns the project for SUPER_ADMIN regardless of company', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [projectRow],
      });
      await expect(service.getById(10, superAdmin)).resolves.toEqual(
        projectRow,
      );
    });

    // 2026-07-24 — 접근 판단은 SP(FN_CHECK_PROJECT_ACCESS, 실제 user_role 배정 여부)의
    // 유일한 책임이라, 앱 레이어는 SP가 result:0으로 반환한 행을 그대로 신뢰한다(회사 일치
    // 여부를 다시 확인하지 않음 — campaign 도메인의 getById와 동일한 패턴).
    it('returns the project as-is when the SP grants access (e.g. DEVELOPER with an assigned user_role)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...projectRow, company_id: 2 }],
      });
      await expect(service.getById(10, developer)).resolves.toMatchObject({
        company_id: 2,
      });
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(service.getById(999, superAdmin)).rejects.toMatchObject({
        resultCode: ResultCode.PROJECT_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects access (20001, no user_role assignment)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.getById(10, developer)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });
  });

  describe('update', () => {
    it('returns the updated project', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [projectRow],
      });
      await expect(
        service.update(10, { edit_count: 0, project_name: 'Renamed' }, 1),
      ).resolves.toEqual(projectRow);
    });

    it('passes edit_count through to the SP call', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [projectRow],
      });

      await service.update(10, { edit_count: 3, project_name: 'Renamed' }, 1);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_PROJECT_UPDATE',
        [10, 3, 'Renamed', null, null, 1],
      );
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.update(10, { edit_count: 0 }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(
        service.update(999, { edit_count: 0 }, 1),
      ).rejects.toMatchObject({
        resultCode: ResultCode.PROJECT_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.update(10, { edit_count: 0 }, 2),
      ).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });
  });

  describe('rotateApiSecret', () => {
    it('returns a fresh plaintext api_secret and secret_rotated_at', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            project_id: 10,
            secret_rotated_at: '2026-07-19 11:00:00',
            edit_count: 1,
          },
        ],
      });

      const result = await service.rotateApiSecret(
        10,
        { edit_count: 0 },
        superAdmin,
      );

      expect(result.project_id).toBe(10);
      expect(result.secret_rotated_at).toBe('2026-07-19 11:00:00');
      expect(result.edit_count).toBe(1);
      expect(result.api_secret).toEqual(expect.any(String));
      expect(result.api_secret).toHaveLength(64);
    });

    it('passes edit_count through to the SP call', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            project_id: 10,
            secret_rotated_at: '2026-07-19 11:00:00',
            edit_count: 1,
          },
        ],
      });

      await service.rotateApiSecret(10, { edit_count: 0 }, superAdmin);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_PROJECT_API_SECRET_ROTATE',
        [10, 0, superAdmin.userId, expect.any(String)],
      );
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count, e.g. double-submit)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.rotateApiSecret(10, { edit_count: 0 }, superAdmin),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(
        service.rotateApiSecret(999, { edit_count: 0 }, superAdmin),
      ).rejects.toMatchObject({ resultCode: ResultCode.PROJECT_NOT_FOUND });
    });

    it('throws PERMISSION_DENIED on 20001 (DEVELOPER without assignment)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.rotateApiSecret(10, { edit_count: 0 }, developer),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
    });
  });

  describe('lookup', () => {
    it('returns project_id/project_name only', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ project_id: 10, project_name: 'RPG Project' }],
      });
      await expect(service.lookup(1, 'GAB_RPG')).resolves.toEqual({
        project_id: 10,
        project_name: 'RPG Project',
      });
    });

    it('throws PROJECT_NOT_FOUND when missing/inactive', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(service.lookup(1, 'UNKNOWN')).rejects.toMatchObject({
        resultCode: ResultCode.PROJECT_NOT_FOUND,
      });
    });
  });
});
