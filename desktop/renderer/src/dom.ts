/** An element of index.html by id; the type parameter names the element it is known to be. */
export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], 'dataset' | 'style'>
> & { dataset?: Record<string, string> };
type Child = Node | string | null | undefined | false;

/** Creates an element with properties, data attributes and children; empty children are skipped. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  { dataset, ...props }: Props<K> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(
    ...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false),
  );
  return node;
};
