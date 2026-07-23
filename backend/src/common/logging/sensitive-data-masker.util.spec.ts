import { maskSensitiveData } from './sensitive-data-masker.util';

describe('maskSensitiveData', () => {
  it('masks known sensitive keys at the top level', () => {
    const result = maskSensitiveData({
      login_id: 'sa',
      password: 'super-secret',
    });

    expect(result).toEqual({ login_id: 'sa', password: '***' });
  });

  it('masks sensitive keys regardless of nesting depth', () => {
    const result = maskSensitiveData({
      data: {
        access_token: 'jwt-token',
        refresh_token: 'refresh-token',
        user: { phone_number: '010-1234-5678', user_name: 'Manager' },
      },
    });

    expect(result).toEqual({
      data: {
        access_token: '***',
        refresh_token: '***',
        user: { phone_number: '***', user_name: 'Manager' },
      },
    });
  });

  it('masks sensitive keys inside arrays', () => {
    const result = maskSensitiveData({
      items: [{ api_secret: 'abc' }, { api_secret_prev: 'def' }],
    });

    expect(result).toEqual({
      items: [{ api_secret: '***' }, { api_secret_prev: '***' }],
    });
  });

  it('is case-insensitive on key names (e.g. HTTP headers)', () => {
    const result = maskSensitiveData({
      Authorization: 'Bearer xyz',
      'X-API-Signature': 'abcdef',
      'X-API-Key': 'plain-project-key',
    });

    expect(result).toEqual({
      Authorization: '***',
      'X-API-Signature': '***',
      'X-API-Key': 'plain-project-key',
    });
  });

  it('leaves non-sensitive values untouched', () => {
    const result = maskSensitiveData({ page: 1, page_size: 20 });
    expect(result).toEqual({ page: 1, page_size: 20 });
  });

  it('passes through primitives and null/undefined as-is', () => {
    expect(maskSensitiveData(null)).toBeNull();
    expect(maskSensitiveData(undefined)).toBeUndefined();
    expect(maskSensitiveData('plain string')).toBe('plain string');
    expect(maskSensitiveData(42)).toBe(42);
  });
});
