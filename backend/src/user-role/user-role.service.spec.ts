import { SpExecutorService } from '../common/database/sp-executor.service';
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
});
