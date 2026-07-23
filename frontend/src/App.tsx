import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import { BrowserRouter } from 'react-router-dom';
import { SessionBoot } from '@/app/SessionBoot';
import { AppRoutes } from '@/routes/AppRoutes';

function App() {
  return (
    <ConfigProvider locale={koKR}>
      <BrowserRouter>
        <SessionBoot>
          <AppRoutes />
        </SessionBoot>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
