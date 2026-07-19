import { SpExecutorService } from '../common/database/sp-executor.service';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { UserRoleService } from './user-role.service';

describe('UserRoleService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let service: UserRoleService;

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    service = new UserRoleService(spExecutor as unknown as SpExecutorService);
  });

  it('returns role_code=10 for SUPER_ADMIN without calling the SP', async () => {
    const result = await service.getMyRoleForProject(
      1,
      RoleCode.SUPER_ADMIN,
      10,
    );

    expect(result).toEqual({ project_id: 10, role_code: RoleCode.SUPER_ADMIN });
    expect(spExecutor.callProcedure).not.toHaveBeenCalled();
  });

  it('returns the actual role_code when an active assignment exists', async () => {
    spExecutor.callProcedure.mockResolvedValueOnce({
      result: 0,
      data: [{ role_code: RoleCode.MANAGER }],
    });

    const result = await service.getMyRoleForProject(2, RoleCode.DEVELOPER, 10);

    expect(result).toEqual({ project_id: 10, role_code: RoleCode.MANAGER });
  });

  it('returns role_code=null when there is no active assignment', async () => {
    spExecutor.callProcedure.mockResolvedValueOnce({ result: 0, data: [] });

    const result = await service.getMyRoleForProject(2, RoleCode.DEVELOPER, 10);

    expect(result).toEqual({ project_id: 10, role_code: null });
  });

  describe('create', () => {
    const dto = { user_id: 100, project_id: 10, role_code: 40 };

    it('returns the created assignment', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...dto, status: 1, created_at: 't', updated_at: 't' }],
      });

      await expect(service.create(dto, 1)).resolves.toMatchObject(dto);
    });

    it('throws USER_NOT_FOUND on 31003', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31003 });
      await expect(service.create(dto, 1)).rejects.toMatchObject({
        resultCode: ResultCode.USER_NOT_FOUND,
      });
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(service.create(dto, 1)).rejects.toMatchObject({
        resultCode: ResultCode.PROJECT_NOT_FOUND,
      });
    });

    it('throws DISALLOWED_VALUE on 30003 (company mismatch)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30003 });
      await expect(service.create(dto, 1)).rejects.toMatchObject({
        resultCode: ResultCode.DISALLOWED_VALUE,
      });
    });

    it('throws DUPLICATE_DATA on 32001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 32001 });
      await expect(service.create(dto, 1)).rejects.toMatchObject({
        resultCode: ResultCode.DUPLICATE_DATA,
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
    it('strips total_count and builds a paginated result', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            user_id: 100,
            project_id: 10,
            role_code: 40,
            status: 1,
            created_at: 't',
            updated_at: 't',
            total_count: 1,
          },
        ],
      });

      const result = await service.list({ page: 1, page_size: 20 }, 1);

      expect(result.total_count).toBe(1);
      expect(result.items[0]).not.toHaveProperty('total_count');
    });

    it('reports the real total_count when the requested page is out of range', async () => {
      // SP_USER_ROLE_LIST가 offset이 실제 데이터 범위를 벗어나면 user_id 등 데이터 컬럼이
      // 전부 NULL인 채로 total_count만 채운 행 1개를 반환한다(LEFT JOIN ... ON TRUE) — 그 행은
      // items에서 제외돼야 하지만 total_count는 실제 값을 반영해야 한다.
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            user_id: null,
            project_id: null,
            role_code: null,
            status: null,
            created_at: null,
            updated_at: null,
            total_count: 2,
          },
        ],
      });

      const result = await service.list({ page: 2, page_size: 20 }, 1);

      expect(result).toEqual({
        page: 2,
        page_size: 20,
        total_count: 2,
        items: [],
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.list({ page: 1, page_size: 20 }, 2),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
    });
  });

  describe('update', () => {
    it('returns the updated assignment', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            user_id: 100,
            project_id: 10,
            role_code: 30,
            status: 1,
            created_at: 't',
            updated_at: 't',
          },
        ],
      });

      await expect(
        service.update(100, 10, { role_code: 30 }, 1),
      ).resolves.toMatchObject({ role_code: 30 });
    });

    it('throws DISALLOWED_VALUE on 30003 (role_code=10 attempt)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30003 });
      await expect(
        service.update(100, 10, { role_code: 10 }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.DISALLOWED_VALUE });
    });

    it('throws USER_ROLE_NOT_FOUND on 31007', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31007 });
      await expect(
        service.update(999, 999, { status: 0 }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.USER_ROLE_NOT_FOUND });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.update(100, 10, { status: 0 }, 2),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
    });
  });
});
