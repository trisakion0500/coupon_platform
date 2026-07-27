import { Layout } from 'antd';
import { Outlet } from 'react-router-dom';
import { Footer } from '@/layouts/Footer';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';

/** 18_LAYOUT.md 5장 — 미인증 전용. 사이드바·헤더 없이 중앙 정렬, 공통 Footer만 적용. */
export function AuthLayout() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 16 }}>
        <LanguageSwitcher />
      </div>
      <Layout.Content
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
        }}
      >
        <Outlet />
      </Layout.Content>
      <Footer />
    </Layout>
  );
}
