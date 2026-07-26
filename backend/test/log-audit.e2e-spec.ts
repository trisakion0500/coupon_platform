import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import { CompanyResponseDto } from '../src/company/dto/company-response.dto';
import type { PaginatedResult } from '../src/common/response/pagination';
import { ResultCode } from '../src/common/response/result-code.enum';
import {
  LogAuditDetailDto,
  LogAuditListItemDto,
} from '../src/log-audit/dto/log-audit-response.dto';
import {
  ApiSecretRotateResponseDto,
  ProjectCreateResponseDto,
  ProjectResponseDto,
} from '../src/project/dto/project-response.dto';
import { UserResponseDto } from '../src/user/dto/user-response.dto';
import { UserRoleResponseDto } from '../src/user-role/dto/user-role-response.dto';
import { failure, success } from './utils/envelope';
import { createE2eApp } from './utils/test-app';

/**
 * 13_LOG_AUDIT_API.md 4~6장(`GET /log-audits`/`GET /log-audits/{idx}`) E2E. `log_audit`은
 * company/project/user/user_role E2E 스펙이 실행되며 이미 여러 건 쌓이지만(같은 DB 리셋
 * 라이프사이클을 공유 — `company.e2e-spec.ts` 크로스 파일 오염 교훈 참고), 이 파일은 자기가 직접
 * 만든 대상(company/project/user/user_role)의 target_id/project_id로 필터링해 다른 파일의
 * 로그와 섞이지 않게 한다.
 *
 * 핵심은 **DEVELOPER 스코핑의 비대칭**: `GET /log-audits`(목록)는 범위 밖 로그를 조용히
 * 필터링하지만(에러 아님), `GET /log-audits/{idx}`(상세)는 범위 밖이면 명시적으로
 * PERMISSION_DENIED(20001)를 던진다 — 로그 DB가 메인 DB의 `user_role`을 못 봐서 이 서비스가
 * 유일한 방어선이라는 사정 때문에 생긴 두 엔드포인트 간 의도된 비대칭이다.
 *
 * @author trisakion
 */
describe('Log Audit E2E (13_LOG_AUDIT_API.md 4~6장)', () => {
  let app: INestApplication;
  let saAccessToken: string;
  let devAccessToken: string;
  let mgrAccessToken: string;

  let companyId: number;
  let projectId: number;
  let targetUserId: number;

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
    devAccessToken = await login('dev'); // company_id=2, DEV_PROJECT(project_id=2)에만 배정됨
    mgrAccessToken = await login('mgr');

    // company 로그: CREATE + UPDATE
    const createCompanyRes = await request(app.getHttpServer())
      .post('/companies')
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({
        company_code: 'E2E_LOG_AUDIT_CO',
        company_name: 'E2E 감사로그 회사',
      })
      .expect(200);
    companyId = success<CompanyResponseDto>(createCompanyRes).data.company_id;
    await request(app.getHttpServer())
      .patch(`/companies/${companyId}`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ company_name: 'E2E 감사로그 회사(수정됨)' })
      .expect(200);

    // project 로그: CREATE + UPDATE + API_SECRET_ROTATE(전부 table_name='project')
    const createProjectRes = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({
        company_id: 2,
        project_code: 'E2E_LOG_AUDIT_PROJ',
        project_name: 'E2E 감사로그 프로젝트',
      })
      .expect(200);
    const project = success<ProjectCreateResponseDto>(createProjectRes).data;
    projectId = project.project_id;

    const patchProjectRes = await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ edit_count: project.edit_count, project_name: '수정됨' })
      .expect(200);
    const patchedProject = success<ProjectResponseDto>(patchProjectRes).data;

    const rotateRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/api-secret/rotate`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ edit_count: patchedProject.edit_count })
      .expect(200);
    success<ApiSecretRotateResponseDto>(rotateRes);

    // user 로그: STATUS_CHANGE(승인) + UPDATE(수정) + UPDATE(비번초기화)
    const signupRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        company_id: 2,
        login_id: 'e2e_log_audit_user',
        password: 'Passw0rd!23',
        user_name: 'E2E 감사로그 사용자',
        email: 'e2e_log_audit_user@example.com',
        phone_number: '010-5555-6666',
      })
      .expect(200);
    targetUserId = success<UserResponseDto>(signupRes).data.user_id;

    await request(app.getHttpServer())
      .post(`/users/${targetUserId}/approve`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/users/${targetUserId}`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ department: '감사팀' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/users/${targetUserId}/reset-password`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ new_password: 'ResetPassw0rd!9' })
      .expect(200);

    // user_role 로그: CREATE + UPDATE(전부 table_name='user_role', 위 project에 배정)
    const createRoleRes = await request(app.getHttpServer())
      .post('/user-roles')
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ user_id: targetUserId, project_id: projectId, role_code: 40 })
      .expect(200);
    success<UserRoleResponseDto>(createRoleRes);
    await request(app.getHttpServer())
      .patch(`/user-roles/${targetUserId}/${projectId}`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ role_code: 30 })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /log-audits — 목록', () => {
    it('company 로그는 CREATE/UPDATE 2건이 target_id로 정확히 필터링된다', async () => {
      const res = await request(app.getHttpServer())
        .get('/log-audits')
        .query({ table_name: 'company', target_id: String(companyId) })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      const body = success<PaginatedResult<LogAuditListItemDto>>(res);
      expect(body.data.total_count).toBe(2);
      expect(body.data.items.map((l) => l.action).sort()).toEqual([10, 20]);
    });

    it('action 필터를 주면 CREATE(10)만 반환한다', async () => {
      const res = await request(app.getHttpServer())
        .get('/log-audits')
        .query({
          table_name: 'company',
          target_id: String(companyId),
          action: 10,
        })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      const body = success<PaginatedResult<LogAuditListItemDto>>(res);
      expect(body.data.total_count).toBe(1);
      expect(body.data.items[0].action).toBe(10);
    });

    it('project 로그는 CREATE/UPDATE/API_SECRET_ROTATE 3건 모두 project_id로 필터링된다', async () => {
      const res = await request(app.getHttpServer())
        .get('/log-audits')
        .query({ table_name: 'project', project_id: projectId })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      const body = success<PaginatedResult<LogAuditListItemDto>>(res);
      expect(body.data.total_count).toBe(3);
    });

    it('user 로그는 STATUS_CHANGE(승인)+UPDATE(수정)+UPDATE(비번초기화) 3건이다', async () => {
      const res = await request(app.getHttpServer())
        .get('/log-audits')
        .query({ table_name: 'user', target_id: String(targetUserId) })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      const body = success<PaginatedResult<LogAuditListItemDto>>(res);
      expect(body.data.total_count).toBe(3);
      expect(body.data.items.map((l) => l.action).sort()).toEqual([20, 20, 30]);
    });

    it('user_role 로그는 CREATE+UPDATE 2건이 project_id로 필터링된다', async () => {
      const res = await request(app.getHttpServer())
        .get('/log-audits')
        .query({ table_name: 'user_role', project_id: projectId })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      const body = success<PaginatedResult<LogAuditListItemDto>>(res);
      expect(body.data.total_count).toBe(2);
    });

    it('DEVELOPER는 배정 없는 프로젝트의 project/user_role 로그를 조용히 필터링당해 빈 목록을 받는다(에러 아님)', async () => {
      const projectLogRes = await request(app.getHttpServer())
        .get('/log-audits')
        .query({ table_name: 'project', project_id: projectId })
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(200);
      expect(
        success<PaginatedResult<LogAuditListItemDto>>(projectLogRes).data
          .total_count,
      ).toBe(0);

      const roleLogRes = await request(app.getHttpServer())
        .get('/log-audits')
        .query({ table_name: 'user_role', project_id: projectId })
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(200);
      expect(
        success<PaginatedResult<LogAuditListItemDto>>(roleLogRes).data
          .total_count,
      ).toBe(0);
    });

    it('DEVELOPER는 company_id 필터를 줘도 본인 소속 회사로 강제되어 새 회사의 로그는 안 보인다', async () => {
      const res = await request(app.getHttpServer())
        .get('/log-audits')
        .query({ table_name: 'company', company_id: companyId })
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(200);
      expect(
        success<PaginatedResult<LogAuditListItemDto>>(res).data.total_count,
      ).toBe(0);
    });

    it('MANAGER/OPERATOR는 관리메뉴 자체 접근권한이 없어 PERMISSION_DENIED(20001)', async () => {
      const res = await request(app.getHttpServer())
        .get('/log-audits')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });
  });

  describe('GET /log-audits/:idx — 상세', () => {
    let companyLogIdx: number;
    let projectLogIdx: number;

    beforeAll(async () => {
      const companyLogRes = await request(app.getHttpServer())
        .get('/log-audits')
        .query({
          table_name: 'company',
          target_id: String(companyId),
          action: 20,
        })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      companyLogIdx =
        success<PaginatedResult<LogAuditListItemDto>>(companyLogRes).data
          .items[0].idx;

      const projectLogRes = await request(app.getHttpServer())
        .get('/log-audits')
        .query({ table_name: 'project', project_id: projectId, action: 10 })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      projectLogIdx =
        success<PaginatedResult<LogAuditListItemDto>>(projectLogRes).data
          .items[0].idx;
    });

    it('SUPER_ADMIN은 before_json/after_json이 포함된 상세를 조회할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .get(`/log-audits/${companyLogIdx}`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      const body = success<LogAuditDetailDto>(res);
      expect(body.data.before_json?.company_name).toBe('E2E 감사로그 회사');
      expect(body.data.after_json.company_name).toBe(
        'E2E 감사로그 회사(수정됨)',
      );
    });

    it('DEVELOPER는 배정 없는 프로젝트의 로그 상세조회 시 PERMISSION_DENIED(20001)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/log-audits/${projectLogIdx}`)
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('DEVELOPER는 타 회사 로그 상세조회 시 PERMISSION_DENIED(20001)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/log-audits/${companyLogIdx}`)
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('존재하지 않는 idx는 LOG_AUDIT_NOT_FOUND(31008)', async () => {
      const res = await request(app.getHttpServer())
        .get('/log-audits/999999999')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.LOG_AUDIT_NOT_FOUND);
    });
  });
});
