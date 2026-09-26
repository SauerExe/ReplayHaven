// getRandomValues also works on a private HTTP LAN address, where randomUUID may be absent.
export function createId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const data = crypto.getRandomValues(new Uint8Array(16));
  data[6] = (data[6] & 15) | 64;
  data[8] = (data[8] & 63) | 128;
  const hex = Array.from(data, (n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
