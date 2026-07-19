import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { CryptoService } from '../common/crypto/crypto.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { AuthService } from './auth.service';

function buildConfigService(): ConfigService {
  const encryptionKey = randomBytes(32).toString('hex');
  const values: Record<string, string> = {
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    ENCRYPTION_KEY: encryptionKey,
  };
  return {
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('AuthService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let jwtService: JwtService;
  let cryptoService: CryptoService;
  let service: AuthService;

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    jwtService = new JwtService({ secret: 'test-jwt-secret' });
    cryptoService = new CryptoService(buildConfigService());
    service = new AuthService(
      spExecutor as unknown as SpExecutorService,
      jwtService,
      buildConfigService(),
      cryptoService,
    );
  });

  describe('signup', () => {
    const dto = {
      company_id: 1,
      requested_project_id: 1,
      login_id: 'newuser',
      password: 'password123',
      user_name: 'New User',
      email: 'new@example.com',
      phone_number: '010-1234-5678',
    };

    it('returns the created user without password_hash, with phone_number decrypted', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            user_id: 10,
            company_id: 1,
            requested_project_id: 1,
            login_id: 'newuser',
            user_name: 'New User',
            email: 'new@example.com',
            phone_number: cryptoService.encrypt('010-1234-5678'),
            department: null,
            position: null,
            status: 0,
            last_login_at: null,
            created_at: '2026-07-19 10:00:00',
            updated_at: '2026-07-19 10:00:00',
          },
        ],
      });

      const result = await service.signup(dto);

      expect(result).toMatchObject({
        user_id: 10,
        login_id: 'newuser',
        phone_number: '010-1234-5678',
        status: 0,
      });
      expect(result).not.toHaveProperty('password_hash');
    });

    it('throws COMPANY_NOT_FOUND on 31001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31001 });
      await expect(service.signup(dto)).rejects.toMatchObject({
        resultCode: ResultCode.COMPANY_NOT_FOUND,
      });
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(service.signup(dto)).rejects.toMatchObject({
        resultCode: ResultCode.PROJECT_NOT_FOUND,
      });
    });

    it('throws DUPLICATE_DATA on 32001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 32001 });
      await expect(service.signup(dto)).rejects.toMatchObject({
        resultCode: ResultCode.DUPLICATE_DATA,
      });
    });

    it('propagates DATABASE_ERROR when the SP call throws it (SP system error)', async () => {
      spExecutor.callProcedure.mockRejectedValueOnce(
        new BusinessException(ResultCode.DATABASE_ERROR),
      );
      await expect(service.signup(dto)).rejects.toMatchObject({
        resultCode: ResultCode.DATABASE_ERROR,
      });
    });
  });

  describe('login', () => {
    const loginDto = { login_id: 'sa', password: 'correct-password' };

    async function mockLoginLookup(
      overrides: Partial<Record<string, unknown>> = {},
    ) {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            user_id: 1,
            company_id: 1,
            requested_project_id: 1,
            login_id: 'sa',
            password_hash: passwordHash,
            user_name: 'Super Admin',
            email: 'sa@example.com',
            phone_number: cryptoService.encrypt('010-0000-0000'),
            department: null,
            position: null,
            status: 1,
            role_code: 10,
            last_login_at: null,
            created_at: '2026-07-19 10:00:00',
            updated_at: '2026-07-19 10:00:00',
            ...overrides,
          },
        ],
      });
    }

    it('issues tokens on success and creates a session', async () => {
      await mockLoginLookup();
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0 }); // SP_USER_SESSION_CREATE

      const result = await service.login(loginDto);

      expect(result).toMatchObject({ role_code: 10 });
      expect(result.access_token).toEqual(expect.any(String));
      expect(result.refresh_token).toEqual(expect.any(String));
      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        2,
        'SP_USER_SESSION_CREATE',
        expect.arrayContaining([1]),
      );
    });

    it('throws LOGIN_FAILED when login_id does not exist', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 10001 });
      await expect(service.login(loginDto)).rejects.toMatchObject({
        resultCode: ResultCode.LOGIN_FAILED,
      });
    });

    it('propagates DATABASE_ERROR when the SP call throws it, not LOGIN_FAILED', async () => {
      spExecutor.callProcedure.mockRejectedValueOnce(
        new BusinessException(ResultCode.DATABASE_ERROR),
      );
      await expect(service.login(loginDto)).rejects.toMatchObject({
        resultCode: ResultCode.DATABASE_ERROR,
      });
    });

    it('throws PASSWORD_MISMATCH on wrong password', async () => {
      await mockLoginLookup();
      await expect(
        service.login({ login_id: 'sa', password: 'wrong-password' }),
      ).rejects.toMatchObject({ resultCode: ResultCode.PASSWORD_MISMATCH });
    });

    it('throws SIGNUP_PENDING_APPROVAL when status=0', async () => {
      await mockLoginLookup({ status: 0 });
      await expect(service.login(loginDto)).rejects.toMatchObject({
        resultCode: ResultCode.SIGNUP_PENDING_APPROVAL,
      });
    });

    it('throws SIGNUP_REJECTED when status=2', async () => {
      await mockLoginLookup({ status: 2 });
      await expect(service.login(loginDto)).rejects.toMatchObject({
        resultCode: ResultCode.SIGNUP_REJECTED,
      });
    });

    it('throws ACCOUNT_SUSPENDED when status=3', async () => {
      await mockLoginLookup({ status: 3 });
      await expect(service.login(loginDto)).rejects.toMatchObject({
        resultCode: ResultCode.ACCOUNT_SUSPENDED,
      });
    });
  });

  describe('logout', () => {
    it('resolves when the SP succeeds', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0 });
      await expect(service.logout('some-jti')).resolves.toBeUndefined();
    });

    it('propagates DATABASE_ERROR when the SP call throws it (does not silently succeed)', async () => {
      spExecutor.callProcedure.mockRejectedValueOnce(
        new BusinessException(ResultCode.DATABASE_ERROR),
      );
      await expect(service.logout('some-jti')).rejects.toMatchObject({
        resultCode: ResultCode.DATABASE_ERROR,
      });
    });
  });

  describe('refresh', () => {
    it('issues a new access token and updates the session JTI', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            session_id: 5,
            user_id: 1,
            user_status: 1,
            company_id: 1,
            role_code: 20,
          },
        ],
      });
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0 }); // SP_USER_SESSION_UPDATE_JTI

      const result = await service.refresh({
        refresh_token: 'some-refresh-token',
      });

      expect(result).toMatchObject({ role_code: 20 });
      expect(result.access_token).toEqual(expect.any(String));
      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        2,
        'SP_USER_SESSION_UPDATE_JTI',
        [5, expect.any(String)],
      );
    });

    it('throws REFRESH_TOKEN_EXPIRED when session is missing/expired', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 10008 });
      await expect(
        service.refresh({ refresh_token: 'invalid' }),
      ).rejects.toMatchObject({ resultCode: ResultCode.REFRESH_TOKEN_EXPIRED });
    });

    it('propagates DATABASE_ERROR when the SP call throws it, not REFRESH_TOKEN_EXPIRED', async () => {
      spExecutor.callProcedure.mockRejectedValueOnce(
        new BusinessException(ResultCode.DATABASE_ERROR),
      );
      await expect(
        service.refresh({ refresh_token: 'whatever' }),
      ).rejects.toMatchObject({ resultCode: ResultCode.DATABASE_ERROR });
    });
  });

  describe('getMe', () => {
    it('returns the user without password_hash, with phone_number decrypted', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            user_id: 1,
            company_id: 1,
            requested_project_id: 1,
            login_id: 'sa',
            password_hash: 'irrelevant-hash',
            user_name: 'Super Admin',
            email: 'sa@example.com',
            phone_number: cryptoService.encrypt('010-0000-0000'),
            department: null,
            position: null,
            status: 1,
            last_login_at: '2026-07-19 10:00:00',
            created_at: '2026-07-19 10:00:00',
            updated_at: '2026-07-19 10:00:00',
          },
        ],
      });

      const result = await service.getMe(1, 10);

      expect(result).toMatchObject({
        user_id: 1,
        phone_number: '010-0000-0000',
      });
      expect(result).not.toHaveProperty('password_hash');
    });

    it('propagates DATABASE_ERROR when the SP call throws it, not USER_NOT_FOUND', async () => {
      spExecutor.callProcedure.mockRejectedValueOnce(
        new BusinessException(ResultCode.DATABASE_ERROR),
      );
      await expect(service.getMe(1, 10)).rejects.toMatchObject({
        resultCode: ResultCode.DATABASE_ERROR,
      });
    });

    it('throws USER_NOT_FOUND when the user does not exist', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31003 });
      await expect(service.getMe(999, 10)).rejects.toMatchObject({
        resultCode: ResultCode.USER_NOT_FOUND,
      });
    });
  });

  describe('changePassword', () => {
    it('updates the password when the current password matches', async () => {
      const currentHash = await bcrypt.hash('old-password', 12);
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ user_id: 1, password_hash: currentHash }],
      });
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0 }); // SP_USER_PASSWORD_CHANGE

      await expect(
        service.changePassword(1, 10, {
          current_password: 'old-password',
          new_password: 'new-password',
        }),
      ).resolves.toBeUndefined();

      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        2,
        'SP_USER_PASSWORD_CHANGE',
        [1, expect.any(String)],
      );
    });

    it('throws PASSWORD_MISMATCH when the current password is wrong', async () => {
      const currentHash = await bcrypt.hash('old-password', 12);
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ user_id: 1, password_hash: currentHash }],
      });

      await expect(
        service.changePassword(1, 10, {
          current_password: 'wrong-password',
          new_password: 'new-password',
        }),
      ).rejects.toMatchObject({ resultCode: ResultCode.PASSWORD_MISMATCH });
    });

    it('propagates DATABASE_ERROR when the update SP call throws it', async () => {
      const currentHash = await bcrypt.hash('old-password', 12);
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ user_id: 1, password_hash: currentHash }],
      });
      spExecutor.callProcedure.mockRejectedValueOnce(
        new BusinessException(ResultCode.DATABASE_ERROR),
      );

      await expect(
        service.changePassword(1, 10, {
          current_password: 'old-password',
          new_password: 'new-password',
        }),
      ).rejects.toMatchObject({ resultCode: ResultCode.DATABASE_ERROR });
    });
  });
});
