import { CryptoService } from '../common/crypto/crypto.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let crypto: jest.Mocked<Pick<CryptoService, 'encrypt'>>;
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
    service = new ProjectService(
      spExecutor as unknown as SpExecutorService,
      crypto as unknown as CryptoService,
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

      const result = await service.create(dto);

      expect(result).toMatchObject(createdRow);
      expect(result.api_secret).toEqual(expect.any(String));
      expect(result.api_secret).toHaveLength(64);
    });

    it('throws COMPANY_NOT_FOUND on 31001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31001 });
      await expect(service.create(dto)).rejects.toMatchObject({
        resultCode: ResultCode.COMPANY_NOT_FOUND,
      });
    });

    it('throws DUPLICATE_DATA on 32001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 32001 });
      await expect(service.create(dto)).rejects.toMatchObject({
        resultCode: ResultCode.DUPLICATE_DATA,
      });
    });

    it('propagates DATABASE_ERROR when the SP call throws it', async () => {
      spExecutor.callProcedure.mockRejectedValueOnce(
        new BusinessException(ResultCode.DATABASE_ERROR),
      );
      await expect(service.create(dto)).rejects.toMatchObject({
        resultCode: ResultCode.DATABASE_ERROR,
      });
    });
  });

  describe('list', () => {
    it('forces company_id to the requester company for DEVELOPER', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0, data: [] });

      await service.list({ page: 1, page_size: 20 }, developer);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith('SP_PROJECT_LIST', [
        developer.companyId,
        null,
        20,
        0,
        developer.userId,
        developer.roleCode,
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
        superAdmin.roleCode,
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

    it('throws PERMISSION_DENIED when the SP rejects the company scope (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.list({ page: 1, page_size: 20 }, developer),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
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

    it('returns the project for DEVELOPER in the same company', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...projectRow, company_id: 2 }],
      });
      await expect(service.getById(10, developer)).resolves.toMatchObject({
        company_id: 2,
      });
    });

    it('throws PERMISSION_DENIED for DEVELOPER in a different company', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [projectRow],
      });
      await expect(service.getById(10, developer)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(service.getById(999, superAdmin)).rejects.toMatchObject({
        resultCode: ResultCode.PROJECT_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects the company scope (20001)', async () => {
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
        service.update(10, { project_name: 'Renamed' }),
      ).resolves.toEqual(projectRow);
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(service.update(999, {})).rejects.toMatchObject({
        resultCode: ResultCode.PROJECT_NOT_FOUND,
      });
    });
  });

  describe('rotateApiSecret', () => {
    it('returns a fresh plaintext api_secret and secret_rotated_at', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ project_id: 10, secret_rotated_at: '2026-07-19 11:00:00' }],
      });

      const result = await service.rotateApiSecret(10, superAdmin);

      expect(result.project_id).toBe(10);
      expect(result.secret_rotated_at).toBe('2026-07-19 11:00:00');
      expect(result.api_secret).toEqual(expect.any(String));
      expect(result.api_secret).toHaveLength(64);
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(
        service.rotateApiSecret(999, superAdmin),
      ).rejects.toMatchObject({ resultCode: ResultCode.PROJECT_NOT_FOUND });
    });

    it('throws PERMISSION_DENIED on 20001 (DEVELOPER without assignment)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.rotateApiSecret(10, developer),
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
