import type { Messages } from '../types';

export const auth = {
  // AuthGate.tsx
  'auth.signInFailed': 'Sign-in failed.',
  'auth.checking': 'Checking connection',
  'auth.dismiss': 'Dismiss',
  'auth.failed': 'That didn’t work.',
  'auth.passwordMismatch': 'The two passwords don’t match.',
  'auth.title.setup': 'Create your admin account',
  'auth.title.login': 'Sign in to your account',
  'auth.lead.setup':
    'You sign in on every device with this account. It becomes the admin of this server.',
  'auth.sso.signInWith': 'Sign in with {name}',
  'auth.sso.generic': 'single sign-on',
  'auth.sso.setupLead': 'Sign in with {name}. The first account becomes the admin of this server.',
  'auth.sso.loginLead': 'This server uses {name} for sign-in.',
  'auth.sso.notConfigured': 'Single sign-on is not configured on this server.',
  'auth.or': 'or',
  'auth.field.name': 'Name',
  'auth.field.password': 'Password',
  'auth.field.repeat': 'Repeat password',
  'auth.field.passwordHint': 'At least 8 characters.',
  'auth.field.key': 'Setup access key',
  'auth.field.keyHint':
    'It is in your {file} as {name}. It prevents anyone else from creating the first account.',
  'auth.field.keyFromLink': 'Access key filled in from the setup link.',
  'auth.field.keyShow': 'Change',
  'auth.missing.name': 'Enter your name.',
  'auth.missing.password': 'Enter your password.',
  'auth.missing.key': 'Enter the access key from the server setup.',
  'auth.passwordShort': 'The password needs at least 8 characters.',
  'auth.qr.toggle': 'Use a QR code instead',
  'auth.qr.steps':
    'On a device that is already signed in, open Settings → Devices, choose “Connect phone” and scan the code with this phone’s camera.',
  'auth.help.login':
    'Signing in on your phone? Scan the QR code under Settings → Devices on a signed-in device.',
  'auth.help.setup': 'After this you pair your recording PCs with one click.',
  'auth.help.connect': 'Codes are valid for a few minutes and work once.',
  'auth.submit.setup': 'Create account',
  'auth.submit.login': 'Sign in',
  'auth.submitting': 'Please wait',
  'auth.language': 'Language',
  'auth.aside.eyebrow': 'Your clip archive',
  'auth.aside.title': 'Every highlight, named and kept.',
  'auth.aside.lead':
    'Your PC watches the recording folder, names each clip with local AI and hands the original to your own server.',
  'auth.aside.ai.title': 'Named on your PC',
  'auth.aside.ai.text':
    'Kills, map and moment, read by a model on your gaming PC. No frame goes to a cloud service.',
  'auth.aside.server.title': 'Originals on your server',
  'auth.aside.server.text': 'Full quality, with a smooth version for streaming on the go.',
  'auth.aside.devices.title': 'On every device',
  'auth.aside.devices.text': 'Browser, phone or TV. Sign in once, stay signed in for 30 days.',
  'auth.aside.sampleTag': 'AI title',
  'auth.aside.trust': 'Self-hosted · Source-available · Your clips stay on your hardware',
  'auth.aside.sampleTitle': 'Ace on Inferno',
  'auth.connect.codeFailed': 'The code could not be redeemed.',
  'auth.connect.signingIn': 'Signing in this device …',
  'auth.connect.failedTitle': 'This code didn’t work',
  'auth.connect.failedLead':
    'Ask for a new QR code under Settings → Devices on a signed-in device, or sign in with your name and password.',
  'auth.connect.toLogin': 'Go to sign-in',
} satisfies Messages;
