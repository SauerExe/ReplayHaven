/** A namespace of English source strings: flat keys such as `stream.hero.play`. */
export type Messages = Record<string, string>;

/**
 * The same keys in another language. Missing or extra keys are type errors, so every
 * translation stays complete when the English dictionary grows.
 */
export type Translation<T extends Messages> = { [K in keyof T]: string };

export type Params = Record<string, string | number>;
