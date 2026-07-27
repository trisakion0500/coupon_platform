import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import type { PaginatedResult } from '../src/common/response/pagination';
import { ResultCode } from '../src/common/response/result-code.enum';
import { UserResponseDto } from '../src/user/dto/user-response.dto';
import {
  MyRoleForProjectDto,
  UserRoleResponseDto,
} from '../src/user-role/dto/user-role-response.dto';
import { failure, success } from './utils/envelope';
import { createE2eApp } from './utils/test-app';

/**
 * `GET /user-roles/me`(13_PROJECT_API.md 3.1, 전체 role) + 14_USER_API.md 3장(User Role
 * 생성/목록/수정, SUPER_ADMIN 전용) E2E. 배정 대상은 시드 계정을 건드리지 않기 위해 새로
 * 가입+승인시킨 사용자를 회사 2(DEV) 프로젝트 2(DEV_PROJECT)에 배정한다.
 *
 * @author trisakion
 */
describe('User Role E2E (13_PROJECT_API.md 3.1 / 14_USER_API.md 3장)', () => {
  let app: INestApplication;
  let saAccessToken: string;
  let devAccessToken: string;
  let assigneeUserId: number;

  beforeAll(async () => {
    app = await createE2eApp();

    const login = async (loginId: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: loginId, password: '1234' })
        .expect(200);
      return success<LoginResponseDto>(res).data.access_token;
    };

    saAccessToken = await login('sa');
    devAccessToken = await login('dev');

    const signupRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        company_id: 2,
        login_id: 'e2e_role_assignee',
        password: 'Passw0rd!23',
        user_name: '권한배정 대상',
        email: 'e2e_role_assignee@example.com',
        phone_number: '010-3333-4444',
      })
      .expect(200);
    assigneeUserId = success<UserResponseDto>(signupRes).data.user_id;

    await request(app.getHttpServer())
      .post(`/users/${assigneeUserId}/approve`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /user-roles/me — 전체 역할, 헤더 프로젝트 선택용', () => {
    it('SUPER_ADMIN(sa)은 배정 여부와 무관하게 항상 role_code:10을 받는다(DB 조회 없음)', async () => {
      const res = await request(app.getHttpServer())
        .get('/user-roles/me')
        .query({ project_id: 1 })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      expect(success<MyRoleForProjectDto>(res).data.role_code).toBe(10);
    });

    it('DEVELOPER(dev)는 배정된 프로젝트(2)에서 본인 role_code(20)를 받는다', async () => {
      const res = await request(app.getHttpServer())
        .get('/user-roles/me')
        .query({ project_id: 2 })
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(200);
      expect(success<MyRoleForProjectDto>(res).data.role_code).toBe(20);
    });

    it('배정되지 않은 프로젝트(1)에서는 role_code:null을 받는다(오류가 아님)', async () => {
      const res = await request(app.getHttpServer())
        .get('/user-roles/me')
        .query({ project_id: 1 })
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(200);
      expect(success<MyRoleForProjectDto>(res).data.role_code).toBeNull();
    });
  });

  describe('POST /user-roles — 권한배정 생성(SUPER_ADMIN 전용)', () => {
    it('SUPER_ADMIN은 새 사용자를 프로젝트에 배정할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .post('/user-roles')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ user_id: assigneeUserId, project_id: 2, role_code: 40 })
        .expect(200);

      const body = success<UserRoleResponseDto>(res);
      expect(body.data.role_code).toBe(40);
      expect(body.data.status).toBe(1);
    });

    it('DEVELOPER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/user-roles')
        .set('Authorization', `Bearer ${devAccessToken}`)
        .send({ user_id: assigneeUserId, project_id: 1, role_code: 40 })
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('같은 (user_id, project_id) 중복 배정은 DUPLICATE_DATA(32001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/user-roles')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ user_id: assigneeUserId, project_id: 2, role_code: 30 })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.DUPLICATE_DATA);
    });

    it('사용자 소속 회사와 프로젝트 소속 회사가 다르면 DISALLOWED_VALUE(30003)', async () => {
      // sa는 company_id=1인데 project_id=2는 company_id=2 소속
      const res = await request(app.getHttpServer())
        .post('/user-roles')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ user_id: 1, project_id: 2, role_code: 40 })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.DISALLOWED_VALUE);
    });

    it('존재하지 않는 user_id는 USER_NOT_FOUND(31003)', async () => {
      const res = await request(app.getHttpServer())
        .post('/user-roles')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ user_id: 999999, project_id: 2, role_code: 40 })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.USER_NOT_FOUND);
    });

    it('존재하지 않는 project_id는 PROJECT_NOT_FOUND(31002)', async () => {
      const res = await request(app.getHttpServer())
        .post('/user-roles')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ user_id: assigneeUserId, project_id: 999999, role_code: 40 })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.PROJECT_NOT_FOUND);
    });
  });

  describe('GET /user-roles — 목록(SUPER_ADMIN 전용)', () => {
    it('SUPER_ADMIN은 project_id 필터로 배정 목록을 조회할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .get('/user-roles')
        .query({ project_id: 2 })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);

      const body = success<PaginatedResult<UserRoleResponseDto>>(res);
      expect(body.data.items.some((r) => r.user_id === assigneeUserId)).toBe(
        true,
      );
    });

    it('DEVELOPER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .get('/user-roles')
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });
  });

  describe('PATCH /user-roles/:user_id/:project_id — 배정 수정(SUPER_ADMIN 전용)', () => {
    it('SUPER_ADMIN은 role_code/status를 수정할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/user-roles/${assigneeUserId}/2`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ role_code: 30 })
        .expect(200);
      expect(success<UserRoleResponseDto>(res).data.role_code).toBe(30);
    });

    it('role_code=10(SUPER_ADMIN)으로 바꾸려 하면 DISALLOWED_VALUE(30003)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/user-roles/${assigneeUserId}/2`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ role_code: 10 })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.DISALLOWED_VALUE);
    });

    it('배정 자체가 없는 (user_id, project_id) 조합은 USER_ROLE_NOT_FOUND(31007)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/user-roles/1/2') // sa는 project_id=2에 배정된 적 없음
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ role_code: 30 })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.USER_ROLE_NOT_FOUND);
    });

    it('DEVELOPER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/user-roles/${assigneeUserId}/2`)
        .set('Authorization', `Bearer ${devAccessToken}`)
        .send({ role_code: 40 })
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });
  });
});
