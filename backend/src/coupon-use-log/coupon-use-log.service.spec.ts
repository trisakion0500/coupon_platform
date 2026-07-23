import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { ResultCode } from '../common/response/result-code.enum';
import { CouponUseLogService } from './coupon-use-log.service';

describe('CouponUseLogService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let logSpExecutor: jest.Mocked<Pick<LogSpExecutorService, 'callProcedure'>>;
  let service: CouponUseLogService;

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    logSpExecutor = { callProcedure: jest.fn() };
    service = new CouponUseLogService(
      spExecutor as unknown as SpExecutorService,
      logSpExecutor as unknown as LogSpExecutorService,
    );
  });

  describe('list', () => {
    it('throws REQUIRED_FIELD_MISSING when project_id is missing', async () => {
      await expect(
        service.list({ page: 1, page_size: 20 }, { userId: 1 }),
      ).rejects.toMatchObject({
        resultCode: ResultCode.REQUIRED_FIELD_MISSING,
      });
      expect(spExecutor.callProcedure).not.toHaveBeenCalled();
    });

    it('throws PERMISSION_DENIED when SP_PROJECT_CHECK_ACCESS rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.list(
          { project_id: 10, page: 1, page_size: 20 },
          { userId: 2 },
        ),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
      expect(logSpExecutor.callProcedure).not.toHaveBeenCalled();
    });

    it('queries the log DB and enriches campaign_name after access is confirmed', async () => {
      spExecutor.callProcedure
        .mockResolvedValueOnce({ result: 0 }) // SP_PROJECT_CHECK_ACCESS
        .mockResolvedValueOnce({
          result: 0,
          data: [{ name: '여름 이벤트' }],
        }); // SP_CAMPAIGN_GET_BY_ID (campaign_name lookup)
      logSpExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            idx: 1,
            action: 10,
            project_id: 10,
            coupon_campaign_id: 100,
            code_value: '23A4-B7C9-DEF2',
            game_user_id: 'player_1001',
            result_type: 0,
            created_at: '2026-07-18 10:00:00',
            total_count: 1,
          },
        ],
      });

      const result = await service.list(
        { project_id: 10, page: 1, page_size: 20 },
        { userId: 1 },
      );

      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        1,
        'SP_PROJECT_CHECK_ACCESS',
        [10, 1],
      );
      expect(logSpExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_LOG_COUPON_USE_LIST',
        [10, null, null, null, null, null, null, null, 20, 0],
      );
      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        2,
        'SP_CAMPAIGN_GET_BY_ID',
        [100, 1],
      );
      expect(result.total_count).toBe(1);
      expect(result.items[0].campaign_name).toBe('여름 이벤트');
    });

    it('leaves campaign_name null when coupon_campaign_id is null (code not found)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0 });
      logSpExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            idx: 2,
            action: 10,
            project_id: 10,
            coupon_campaign_id: null,
            code_value: 'ZZZZ-ZZZZ-ZZZZ',
            game_user_id: 'player_1001',
            result_type: 10,
            created_at: '2026-07-18 09:59:50',
            total_count: 1,
          },
        ],
      });

      const result = await service.list(
        { project_id: 10, page: 1, page_size: 20 },
        { userId: 1 },
      );

      expect(result.items[0].campaign_name).toBeNull();
      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(1); // SP_PROJECT_CHECK_ACCESS만
    });

    it('leaves campaign_name null (soft-fail) when the enrichment lookup throws', async () => {
      spExecutor.callProcedure
        .mockResolvedValueOnce({ result: 0 }) // SP_PROJECT_CHECK_ACCESS
        .mockRejectedValueOnce(new Error('connection refused')); // SP_CAMPAIGN_GET_BY_ID
      logSpExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            idx: 1,
            action: 10,
            project_id: 10,
            coupon_campaign_id: 100,
            code_value: '23A4-B7C9-DEF2',
            game_user_id: 'player_1001',
            result_type: 0,
            created_at: '2026-07-18 10:00:00',
            total_count: 1,
          },
        ],
      });

      const result = await service.list(
        { project_id: 10, page: 1, page_size: 20 },
        { userId: 1 },
      );

      expect(result.items[0].campaign_name).toBeNull();
    });
  });
});
