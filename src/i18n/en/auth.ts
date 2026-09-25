import type { Messages } from '../types';

export const auth = {
  // AuthGate.tsx
  'auth.signInFailed': 'Sign-in failed.',
  'auth.checking': 'Checking connection',
  'auth.dismiss': 'Dismiss',
  'auth.failed': 'That didn’t work.',
  'auth.passwordMismatch': 'The two passwords don’t match.',
  'auth.kicker.setup': 'FIRST SETUP',
  'auth.kicker.login': 'YOUR ARCHIVE',
  'auth.title.setup': 'Create your account.',
  'auth.title.login': 'Welcome back.',
  'auth.lead.setup':
    'You sign in on every device with this account. Afterwards you pair recording PCs with one click.',
  'auth.lead.login':
    'Sign in to see your clips. On your phone you can also use a QR code from a signed-in device.',
  'auth.sso.signInWith': 'Sign in with {name}',
  'auth.sso.generic': 'single sign-on',
  'auth.sso.setupTitle': 'Create the first account.',
  'auth.sso.setupLead': 'Sign in with {name}. The first account becomes the admin of this server.',
  'auth.sso.loginLead': 'Sign in with {name} to see your clips.',
  'auth.sso.notConfigured': 'Single sign-on is not configured on this server.',
  'auth.or': 'or',
  'auth.field.name': 'Name',
  'auth.field.password': 'Password',
  'auth.field.repeat': 'Repeat password',
  'auth.field.key': 'Access key from the server setup',
  'auth.field.keyHint':
    'It is in your {file} as {name}. It prevents anyone else from creating the first account.',
  'auth.submit.setup': 'Create account',
  'auth.submit.login': 'Sign in',
  'auth.connect.codeFailed': 'The code could not be redeemed.',
  'auth.connect.signingIn': 'Signing in this device …',
  'auth.connect.toLogin': 'Go to sign-in',
} satisfies Messages;
