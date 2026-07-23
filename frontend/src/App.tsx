import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import enUS from 'antd/locale/en_US';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';
import { SessionBoot } from '@/app/SessionBoot';
import { AppRoutes } from '@/routes/AppRoutes';
import i18n from '@/i18n';

/** antd 자체 로케일(날짜/테이블 페이지네이션 문구 등)도 선택된 언어를 따라가도록 맞춘다. */
function AppShell() {
  const { i18n: i18nInstance } = useTranslation();
  const antdLocale = i18nInstance.language === 'en' ? enUS : koKR;

  return (
    <ConfigProvider locale={antdLocale}>
      <BrowserRouter>
        <SessionBoot>
          <AppRoutes />
        </SessionBoot>
      </BrowserRouter>
    </ConfigProvider>
  );
}

function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <AppShell />
    </I18nextProvider>
  );
}

export default App;
