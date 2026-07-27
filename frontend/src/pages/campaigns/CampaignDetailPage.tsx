import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Result, Spin, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getCampaign } from '@/api/campaign';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { PageHeader } from '@/components/common/PageHeader';
import { RequireProjectSelected } from '@/components/guards/RequireProjectSelected';
import { useGlobalStore } from '@/stores/globalStore';
import type { Campaign } from '@/types/campaign';
import { CampaignInfoTab } from '@/pages/campaigns/tabs/CampaignInfoTab';
import { CampaignCodesTab } from '@/pages/campaigns/tabs/CampaignCodesTab';
import { CampaignUsagesTab } from '@/pages/campaigns/tabs/CampaignUsagesTab';
import { CampaignLogsTab } from '@/pages/campaigns/tabs/CampaignLogsTab';

/** SCR-102. 19_CAMPAIGN_API.md 2.3/4장 — 탭 4개(정보/코드 목록/사용 이력/변경 이력). */
export function CampaignDetailPage() {
  return (
    <RequireProjectSelected>
      <CampaignDetailContent />
    </RequireProjectSelected>
  );
}

function CampaignDetailContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { coupon_campaign_id } = useParams();
  const campaignId = Number(coupon_campaign_id);
  const projectRoleCode = useGlobalStore((state) => state.projectRoleCode);

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [justCreatedNotice, setJustCreatedNotice] = useState(
    Boolean((location.state as { justCreated?: boolean } | null)?.justCreated),
  );

  /**
   * `CampaignCodesTab`이 RANDOM 백그라운드 생성 진행 중 3초 간격으로 이 함수를 반복 호출한다
   * (onReload prop). 여러 요청이 겹친 상태에서 먼저 보낸 요청의 응답이 나중에 도착하면(응답
   * 순서 역전) 최신 데이터를 오래된 데이터로 덮어쓸 수 있어, 매 호출마다 순번을 매겨 그 사이
   * 더 최근 호출이 있었으면 응답을 무시한다.
   */
  const requestIdRef = useRef(0);

  function load() {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    getCampaign(campaignId)
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        setCampaign(data);
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) return;
        const resultCode = getResultCode(error);
        if (resultCode === 31004) {
          setNotFound(true);
        } else if (resultCode === 20001) {
          setForbidden(true);
        } else {
          setErrorMessage(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }

  useEffect(load, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) {
    return (
      <Result
        status="404"
        title={t('campaigns.detail.notFound')}
        extra={
          <Button onClick={() => navigate('/campaigns')}>{t('campaigns.backToList')}</Button>
        }
      />
    );
  }

  if (forbidden) {
    return (
      <Result
        status="403"
        title={t('errors.forbidden.subtitle')}
        extra={
          <Button onClick={() => navigate('/campaigns')}>{t('campaigns.backToList')}</Button>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t('campaigns.detail.title', { id: campaignId })}
        actions={
          <Button onClick={() => navigate('/campaigns')}>{t('campaigns.backToList')}</Button>
        }
      />
      <Spin spinning={loading}>
        {errorMessage && (
          <Alert type="error" message={errorMessage} style={{ marginBottom: 16 }} showIcon />
        )}
        {justCreatedNotice && (
          <Alert
            type="info"
            showIcon
            closable
            onClose={() => setJustCreatedNotice(false)}
            message={t('campaigns.detail.justCreatedNotice')}
            style={{ marginBottom: 16 }}
          />
        )}

        {campaign && (
          <Tabs
            defaultActiveKey={justCreatedNotice ? 'codes' : 'info'}
            items={[
              {
                key: 'info',
                label: t('campaigns.detail.tabs.info'),
                children: (
                  <CampaignInfoTab
                    campaign={campaign}
                    projectRoleCode={projectRoleCode}
                    onReload={load}
                    onCampaignChange={setCampaign}
                  />
                ),
              },
              {
                key: 'codes',
                label: t('campaigns.detail.tabs.codes'),
                children: (
                  <CampaignCodesTab
                    campaign={campaign}
                    projectRoleCode={projectRoleCode}
                    onReload={load}
                  />
                ),
              },
              {
                key: 'usages',
                label: t('campaigns.detail.tabs.usages'),
                children: <CampaignUsagesTab campaignId={campaignId} />,
              },
              {
                key: 'logs',
                label: t('campaigns.detail.tabs.logs'),
                children: <CampaignLogsTab campaignId={campaignId} />,
              },
            ]}
          />
        )}
      </Spin>
    </div>
  );
}
