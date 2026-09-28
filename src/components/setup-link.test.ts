import { expect, it } from 'vitest';
import { splitSetupKey } from './setup-link';

it('reads the access key from the setup link fragment and removes it', () => {
  expect(splitSetupKey('#setup-key=0123abcd')).toEqual({ key: '0123abcd', rest: '' });
  expect(splitSetupKey('setup-key=a%20b%26c')).toEqual({ key: 'a b&c', rest: '' });
  expect(splitSetupKey('#lang=de&setup-key=k')).toEqual({ key: 'k', rest: '#lang=de' });
});

it('leaves other fragments alone', () => {
  expect(splitSetupKey('')).toEqual({ key: '', rest: '' });
  expect(splitSetupKey('#server')).toEqual({ key: '', rest: '#server' });
  expect(splitSetupKey('#not-setup-key=x')).toEqual({ key: '', rest: '#not-setup-key=x' });
});

it('removes an empty key parameter without returning a key', () => {
  expect(splitSetupKey('#setup-key=')).toEqual({ key: '', rest: '' });
});
