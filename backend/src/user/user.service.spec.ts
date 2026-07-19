import { CryptoService } from '../common/crypto/crypto.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { UserService } from './user.service';

describe('UserService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let crypto: jest.Mocked<Pick<CryptoService, 'encrypt' | 'decrypt'>>;
  let service: UserService;

  const userRow = {
    user_id: 100,
    company_id: 2,
    requested_project_id: 2,
    login_id: 'mgr',
    user_name: 'Manager',
    email: 'mgr@example.com',
    phone_number: 'enc(010-0000-0000)',
    department: null,
    position: null,
    status: 1,
    last_login_at: null,
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
    crypto = {
      encrypt: jest.fn((plain: string) => `enc(${plain})`),
      decrypt: jest.fn((enc: string) => enc.replace(/^enc\(|\)$/g, '')),
    };
    service = new UserService(
      spExecutor as unknown as SpExecutorService,
      crypto as unknown as CryptoService,
    );
  });

  describe('list', () => {
    it('forces company_id to the requester company for DEVELOPER', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0, data: [] });

      await service.list({ page: 1, page_size: 20 }, developer);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith('SP_USER_LIST', [
        developer.companyId,
        null,
        20,
        0,
        developer.userId,
      ]);
    });

    it('decrypts phone_number for each item', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...userRow, total_count: 1 }],
      });

      const result = await service.list({ page: 1, page_size: 20 }, superAdmin);

      expect(result.items[0].phone_number).toBe('010-0000-0000');
      expect(result.total_count).toBe(1);
    });

    it('throws PERMISSION_DENIED when the SP rejects the company scope (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.list({ page: 1, page_size: 20 }, developer),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
    });

    it('reports the real total_count when the requested page is out of range', async () => {
      // SP_USER_LIST가 offset이 실제 데이터 범위를 벗어나면 user_id 등 데이터 컬럼이 전부
      // NULL인 채로 total_count만 채운 행 1개를 반환한다(LEFT JOIN ... ON TRUE) — 그 행은
      // items에서 제외돼야 하지만 total_count는 실제 값을 반영해야 한다.
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            user_id: null,
            company_id: null,
            requested_project_id: null,
            login_id: null,
            user_name: null,
            email: null,
            phone_number: null,
            department: null,
            position: null,
            status: null,
            last_login_at: null,
            created_at: null,
            updated_at: null,
            total_count: 7,
          },
        ],
      });

      const result = await service.list({ page: 2, page_size: 20 }, superAdmin);

      expect(result).toEqual({
        page: 2,
        page_size: 20,
        total_count: 7,
        items: [],
      });
    });
  });

  describe('getById', () => {
    it('returns the user for SUPER_ADMIN regardless of company', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [userRow],
      });
      await expect(service.getById(100, superAdmin)).resolves.toMatchObject({
        user_id: 100,
      });
    });

    it('throws PERMISSION_DENIED for DEVELOPER in a different company', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...userRow, company_id: 99 }],
      });
      await expect(service.getById(100, developer)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects the company scope (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.getById(100, developer)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });

    it('throws USER_NOT_FOUND on 31003', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31003 });
      await expect(service.getById(999, superAdmin)).rejects.toMatchObject({
        resultCode: ResultCode.USER_NOT_FOUND,
      });
    });
  });

  describe('approve', () => {
    it('returns the approved user', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...userRow, status: 1 }],
      });
      await expect(service.approve(100, 1)).resolves.toMatchObject({
        status: 1,
      });
    });

    it('throws USER_NOT_FOUND on 31003', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31003 });
      await expect(service.approve(999, 1)).rejects.toMatchObject({
        resultCode: ResultCode.USER_NOT_FOUND,
      });
    });

    it('throws INVALID_STATE_TRANSITION on 30004 (already processed)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(service.approve(100, 1)).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.approve(100, 2)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });
  });

  describe('reject', () => {
    it('throws INVALID_STATE_TRANSITION on 30004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(service.reject(100, 1)).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });
  });

  describe('update', () => {
    it('encrypts phone_number before calling the SP', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [userRow],
      });

      await service.update(100, { phone_number: '010-1111-2222' }, 1);

      expect(crypto.encrypt).toHaveBeenCalledWith('010-1111-2222');
      expect(spExecutor.callProcedure).toHaveBeenCalledWith('SP_USER_UPDATE', [
        100,
        null,
        null,
        'enc(010-1111-2222)',
        null,
        null,
        null,
        1,
      ]);
    });

    it('throws DUPLICATE_DATA on 32001 (email conflict)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 32001 });
      await expect(
        service.update(100, { email: 'dup@example.com' }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.DUPLICATE_DATA });
    });

    it('throws USER_NOT_FOUND on 31003', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31003 });
      await expect(service.update(999, {}, 1)).rejects.toMatchObject({
        resultCode: ResultCode.USER_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.update(100, {}, 2)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });
  });

  describe('resetPassword', () => {
    it('returns the user after resetting the password', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [userRow],
      });

      const result = await service.resetPassword(
        100,
        { new_password: 'new-pass' },
        1,
      );

      expect(result.user_id).toBe(100);
      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_USER_PASSWORD_RESET',
        [100, expect.any(String), 1],
      );
    });

    it('throws USER_NOT_FOUND on 31003', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31003 });
      await expect(
        service.resetPassword(999, { new_password: 'new-pass' }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.USER_NOT_FOUND });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.resetPassword(100, { new_password: 'new-pass' }, 2),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
    });
  });
});
