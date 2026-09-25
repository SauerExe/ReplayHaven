import { app } from './app';
import { auth } from './auth';
import { common } from './common';
import { library } from './library';
import { pages } from './pages';
import { streaming } from './streaming';
import { users } from './users';

/** English is the source language; every other dictionary is typed against these keys. */
export const en = { ...common, ...streaming, ...app, ...pages, ...library, ...auth, ...users };

export type MessageKey = keyof typeof en;
