import { Dropdown, Space } from 'antd';
import type { MenuProps } from 'antd';
import { GlobalOutlined, DownOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { setLanguage, SUPPORTED_LANGUAGES } from '@/i18n';

/**
 * 언어 선택 드롭다운 — `Header`(MainLayout/AdminLayout)와 `AuthLayout`(로그인 전) 양쪽에서
 * 공유한다. 로그인 화면은 `Header` 자체가 없어(16_LAYOUT.md 5장) 별도로 노출해야
 * 로그인 전에도 언어를 바꿀 수 있다.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  const items: MenuProps['items'] = SUPPORTED_LANGUAGES.map((lang) => ({
    key: lang,
    label: t(`language.${lang}`),
  }));

  return (
    <Dropdown
      menu={{
        items,
        selectedKeys: [i18n.language],
        onClick: ({ key }) =>
          setLanguage(key as (typeof SUPPORTED_LANGUAGES)[number]),
      }}
      trigger={['click']}
    >
      <Space style={{ cursor: 'pointer' }}>
        <GlobalOutlined />
        <DownOutlined style={{ fontSize: 10 }} />
      </Space>
    </Dropdown>
  );
}
