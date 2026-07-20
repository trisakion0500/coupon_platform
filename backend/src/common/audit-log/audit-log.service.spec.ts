import { LogSpExecutorService } from '../database/log-sp-executor.service';
import { AuditAction } from './audit-action.enum';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let logSpExecutor: jest.Mocked<Pick<LogSpExecutorService, 'logCall'>>;
  let service: AuditLogService;

  beforeEach(() => {
    logSpExecutor = { logCall: jest.fn() };
    service = new AuditLogService(
      logSpExecutor as unknown as LogSpExecutorService,
    );
  });

  it('calls SP_LOG_AUDIT_CREATE with JSON.stringify\'d before/after snapshots', async () => {
    await service.record({
      action: AuditAction.UPDATE,
      companyId: 1,
      projectId: null,
      tableName: 'company',
      targetId: '1',
      targetName: 'Game Company A',
      beforeJson: { company_name: 'Old Name' },
      afterJson: { company_name: 'New Name' },
      createdBy: 1,
      createdByName: 'Super Admin',
    });

    expect(logSpExecutor.logCall).toHaveBeenCalledWith('SP_LOG_AUDIT_CREATE', [
      AuditAction.UPDATE,
      1,
      null,
      'company',
      '1',
      'Game Company A',
      JSON.stringify({ company_name: 'Old Name' }),
      JSON.stringify({ company_name: 'New Name' }),
      1,
      'Super Admin',
    ]);
  });

  it('passes null through for beforeJson on CREATE (no prior row to snapshot)', async () => {
    await service.record({
      action: AuditAction.CREATE,
      companyId: 1,
      projectId: null,
      tableName: 'company',
      targetId: '1',
      targetName: 'Game Company A',
      beforeJson: null,
      afterJson: { company_name: 'Game Company A' },
      createdBy: 1,
      createdByName: 'Super Admin',
    });

    const params = logSpExecutor.logCall.mock.calls[0][1] as unknown[];
    expect(params[6]).toBeNull();
  });
});
