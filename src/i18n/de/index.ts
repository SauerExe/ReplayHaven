import type { en } from '../en';
import type { Translation } from '../types';
import { app } from './app';
import { auth } from './auth';
import { common } from './common';
import { library } from './library';
import { pages } from './pages';
import { streaming } from './streaming';
import { settings } from './settings';

export const de: Translation<typeof en> = {
  ...common,
  ...streaming,
  ...app,
  ...pages,
  ...library,
  ...auth,
  ...settings,
};
