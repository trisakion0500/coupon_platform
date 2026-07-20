import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { ResultCode } from '../common/response/result-code.enum';
import { CampaignService } from './campaign.service';

describe('CampaignService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let logSpExecutor: jest.Mocked<Pick<LogSpExecutorService, 'logCall'>>;
  let service: CampaignService;

  const campaignRow = {
    coupon_campaign_id: 100,
    project_id: 10,
    name: '여름 이벤트 쿠폰',
    campaign_start: '2026-08-01 00:00:00',
    campaign_end: '2026-08-31 23:59:59',
    code_type: 1,
    use_hyphen: 1,
    requested_qty: 1000,
    generated_qty: 0,
    generation_status: 1,
    generation_error: null,
    usable_qty: 0,
    used_qty: 0,
    use_limit_per_user: 1,
    status: 1,
    approval_status: 2,
    approved_by: null,
    approved_at: null,
    reject_reason: null,
    reward_data: { item_id: 5001, qty: 3 },
    created_by: 4,
    updated_by: 4,
    created_at: '2026-07-20 10:00:00',
    updated_at: '2026-07-20 10:00:00',
    edit_count: 0,
  };

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    logSpExecutor = { logCall: jest.fn() };
    service = new CampaignService(
      spExecutor as unknown as SpExecutorService,
      logSpExecutor as unknown as LogSpExecutorService,
    );
  });

  describe('create', () => {
    const dto = {
      project_id: 10,
      name: '여름 이벤트 쿠폰',
      campaign_start: '2026-08-01 00:00:00',
      campaign_end: '2026-08-31 23:59:59',
      code_type: 1,
      requested_qty: 1000,
      reward_data: { item_id: 5001, qty: 3 },
    };

    it('returns the created campaign and fires a log_coupon_campaign write', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });

      const result = await service.create(dto, 4);

      expect(result).toEqual(campaignRow);
      expect(logSpExecutor.logCall).toHaveBeenCalledWith(
        'SP_LOG_COUPON_CAMPAIGN_CREATE',
        expect.arrayContaining([10, 100, 10]),
      );
    });

    it('serializes reward_data to a JSON string before calling the SP', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });

      await service.create(dto, 4);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_CAMPAIGN_CREATE',
        [
          10,
          '여름 이벤트 쿠폰',
          '2026-08-01 00:00:00',
          '2026-08-31 23:59:59',
          1,
          1,
          1000,
          1,
          JSON.stringify(dto.reward_data),
          4,
        ],
      );
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(service.create(dto, 4)).rejects.toMatchObject({
        resultCode: ResultCode.PROJECT_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.create(dto, 4)).rejects.toMatchObject({
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
            coupon_campaign_id: 100,
            project_id: 10,
            name: '여름 이벤트 쿠폰',
            code_type: 1,
            requested_qty: 1000,
            generated_qty: 1000,
            generation_status: 3,
            usable_qty: 500,
            used_qty: 120,
            status: 2,
            approval_status: 3,
            campaign_start: '2026-08-01 00:00:00',
            campaign_end: '2026-08-31 23:59:59',
            created_at: '2026-07-20 10:00:00',
            updated_at: '2026-07-20 10:00:00',
            total_count: 1,
          },
        ],
      });

      const result = await service.list(
        { page: 1, page_size: 20, project_id: 10 },
        { userId: 1 },
      );

      expect(result.total_count).toBe(1);
      expect(result.items[0].coupon_campaign_id).toBe(100);
    });

    it('reports the real total_count when the requested page is out of range', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            coupon_campaign_id: null,
            project_id: 10,
            name: null,
            code_type: null,
            requested_qty: null,
            generated_qty: null,
            generation_status: null,
            usable_qty: null,
            used_qty: null,
            status: null,
            approval_status: null,
            campaign_start: null,
            campaign_end: null,
            created_at: null,
            updated_at: null,
            total_count: 3,
          },
        ],
      });

      const result = await service.list(
        { page: 2, page_size: 20, project_id: 10 },
        { userId: 1 },
      );

      expect(result).toEqual({
        page: 2,
        page_size: 20,
        total_count: 3,
        items: [],
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects the project scope (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.list({ page: 1, page_size: 20, project_id: 10 }, { userId: 2 }),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
    });
  });

  describe('getById', () => {
    it('returns the campaign', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });
      await expect(
        service.getById(100, { userId: 1 }),
      ).resolves.toEqual(campaignRow);
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(
        service.getById(999, { userId: 1 }),
      ).rejects.toMatchObject({ resultCode: ResultCode.CAMPAIGN_NOT_FOUND });
    });

    it('throws PERMISSION_DENIED when out of scope (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.getById(100, { userId: 2 }),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
    });
  });

  describe('update', () => {
    it('returns the updated campaign and fires a log_coupon_campaign write', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });

      const result = await service.update(
        100,
        { edit_count: 0, name: 'Renamed' },
        4,
      );

      expect(result).toEqual(campaignRow);
      expect(logSpExecutor.logCall).toHaveBeenCalled();
    });

    it('passes edit_count through as the optimistic-lock token', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });

      await service.update(100, { edit_count: 0, name: 'Renamed' }, 4);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_CAMPAIGN_UPDATE',
        [100, 0, 'Renamed', null, null, null, null, null, 4],
      );
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(
        service.update(999, { edit_count: 0 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.CAMPAIGN_NOT_FOUND });
    });

    it('throws INVALID_STATE_TRANSITION on 30004 (ended campaign)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(
        service.update(100, { edit_count: 0 }, 4),
      ).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws DISALLOWED_VALUE on 30003 (usable_qty > generated_qty)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30003 });
      await expect(
        service.update(100, { edit_count: 0, usable_qty: 99999 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.DISALLOWED_VALUE });
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count — someone else edited it first)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.update(100, { edit_count: 0 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });
  });

  describe('changeStatus', () => {
    it('returns the campaign after a valid transition', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...campaignRow, status: 2 }],
      });

      const result = await service.changeStatus(
        100,
        { edit_count: 0, status: 2 },
        4,
      );

      expect(result.status).toBe(2);
      expect(logSpExecutor.logCall).toHaveBeenCalled();
    });

    it('throws INVALID_STATE_TRANSITION on 30004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(
        service.changeStatus(100, { edit_count: 0, status: 4 }, 4),
      ).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(
        service.changeStatus(999, { edit_count: 0, status: 2 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.CAMPAIGN_NOT_FOUND });
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.changeStatus(100, { edit_count: 0, status: 2 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });
  });

  describe('approve', () => {
    it('returns the approved campaign', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...campaignRow, approval_status: 3 }],
      });

      const result = await service.approve(100, { edit_count: 0 }, 1);

      expect(result.approval_status).toBe(3);
      expect(logSpExecutor.logCall).toHaveBeenCalled();
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001, e.g. OPERATOR)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.approve(100, { edit_count: 0 }, 4),
      ).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });

    it('throws INVALID_STATE_TRANSITION on 30004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(
        service.approve(100, { edit_count: 0 }, 1),
      ).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.approve(100, { edit_count: 0 }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });
  });

  describe('reject', () => {
    it('returns the rejected campaign', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...campaignRow, approval_status: 4, reject_reason: 'nope' }],
      });

      const result = await service.reject(
        100,
        { edit_count: 0, reject_reason: 'nope' },
        1,
      );

      expect(result.approval_status).toBe(4);
      expect(logSpExecutor.logCall).toHaveBeenCalled();
    });

    it('throws INVALID_STATE_TRANSITION on 30004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(
        service.reject(100, { edit_count: 0, reject_reason: 'nope' }, 1),
      ).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.reject(100, { edit_count: 0, reject_reason: 'nope' }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });
  });
});
