import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { CompanyService } from './company.service';

describe('CompanyService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let service: CompanyService;

  const companyRow = {
    company_id: 1,
    company_code: 'GAB',
    company_name: 'Game Company A',
    description: null,
    status: 1,
    created_at: '2026-07-19 10:00:00',
    updated_at: '2026-07-19 10:00:00',
  };

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    service = new CompanyService(spExecutor as unknown as SpExecutorService);
  });

  describe('create', () => {
    const dto = { company_code: 'GAB', company_name: 'Game Company A' };

    it('returns the created company', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [companyRow],
      });

      await expect(service.create(dto, 1)).resolves.toEqual(companyRow);
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
    it('strips total_count and builds a paginated result', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...companyRow, total_count: 1 }],
      });

      const result = await service.list({ page: 1, page_size: 20 }, 1);

      expect(result).toEqual({
        page: 1,
        page_size: 20,
        total_count: 1,
        items: [companyRow],
      });
    });

    it('returns total_count=0 for an empty page', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0, data: [] });

      const result = await service.list({ page: 1, page_size: 20 }, 1);

      expect(result).toEqual({
        page: 1,
        page_size: 20,
        total_count: 0,
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

  describe('getById', () => {
    it('returns the company', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [companyRow],
      });
      await expect(service.getById(1, 1)).resolves.toEqual(companyRow);
    });

    it('throws COMPANY_NOT_FOUND on 31001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31001 });
      await expect(service.getById(999, 1)).rejects.toMatchObject({
        resultCode: ResultCode.COMPANY_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.getById(1, 2)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });
  });

  describe('update', () => {
    it('returns the updated company', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [companyRow],
      });
      await expect(
        service.update(1, { company_name: 'Renamed' }, 1),
      ).resolves.toEqual(companyRow);
    });

    it('throws COMPANY_NOT_FOUND on 31001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31001 });
      await expect(service.update(999, {}, 1)).rejects.toMatchObject({
        resultCode: ResultCode.COMPANY_NOT_FOUND,
      });
    });

    it('throws DUPLICATE_DATA on 32001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 32001 });
      await expect(
        service.update(1, { company_code: 'DUP' }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.DUPLICATE_DATA });
    });

    it('propagates DATABASE_ERROR when the SP call throws it', async () => {
      spExecutor.callProcedure.mockRejectedValueOnce(
        new BusinessException(ResultCode.DATABASE_ERROR),
      );
      await expect(service.update(1, {}, 1)).rejects.toMatchObject({
        resultCode: ResultCode.DATABASE_ERROR,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.update(1, {}, 2)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });
  });

  describe('lookup', () => {
    it('returns company_id/company_name only', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ company_id: 1, company_name: 'Game Company A' }],
      });
      await expect(service.lookup('GAB')).resolves.toEqual({
        company_id: 1,
        company_name: 'Game Company A',
      });
    });

    it('throws COMPANY_NOT_FOUND when missing/inactive', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31001 });
      await expect(service.lookup('UNKNOWN')).rejects.toMatchObject({
        resultCode: ResultCode.COMPANY_NOT_FOUND,
      });
    });
  });

  describe('getActiveHeaderData', () => {
    it('splits row_type into companies/projects', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          { row_type: 'COMPANY', id: 1, company_id: 1, name: 'Game Company A' },
          { row_type: 'PROJECT', id: 10, company_id: 1, name: 'RPG Project' },
        ],
      });

      const result = await service.getActiveHeaderData(1, 10, 1);

      expect(result).toEqual({
        companies: [{ company_id: 1, company_name: 'Game Company A' }],
        projects: [
          { project_id: 10, company_id: 1, project_name: 'RPG Project' },
        ],
      });
    });

    it('passes user_id/role_code/company_id through to the SP', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0, data: [] });

      await service.getActiveHeaderData(5, 40, 2);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_COMPANY_GET_ACTIVE_HEADER_DATA',
        [5, 40, 2],
      );
    });
  });
});
