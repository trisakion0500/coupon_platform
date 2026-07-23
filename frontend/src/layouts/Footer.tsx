import { Layout } from 'antd';

/** 16_LAYOUT.md 6장 — MainLayout/AdminLayout/AuthLayout 공통 하단. */
export function Footer() {
  return (
    <Layout.Footer style={{ textAlign: 'center', color: 'rgba(0,0,0,0.45)' }}>
      © 2026 {import.meta.env.VITE_APP_NAME} | v1.0.0 | 문의: support@example.com
    </Layout.Footer>
  );
}
