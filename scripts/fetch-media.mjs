import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const games = [
  { id: 'elden', appId: 1245620, name: 'ELDEN RING', color: '#d1b477', genre: 'Action-RPG' },
  { id: 'cs2', appId: 730, name: 'Counter-Strike 2', color: '#deae71', genre: 'Tactical Shooter' },
  {
    id: 'cyberpunk',
    appId: 1091500,
    name: 'Cyberpunk 2077',
    color: '#e5d65e',
    genre: 'Open World',
  },
  { id: 'forza', appId: 1551360, name: 'Forza Horizon 5', color: '#ed82b0', genre: 'Racing' },
  { id: 'apex', appId: 1172470, name: 'Apex Legends', color: '#ed8b7f', genre: 'Battle Royale' },
];
await mkdir('public/media', { recursive: true });
await mkdir('src/data', { recursive: true });
async function cache(url, path) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buffer = Buffer.from(await r.arrayBuffer());
  const outputPath = path.replace(/\.jpg$/, '.webp');
  await sharp(buffer)
    .resize({ width: path.includes('cover') ? 600 : 1600, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(`public/media/${outputPath}`);
  await sharp(buffer)
    .resize({ width: path.includes('cover') ? 400 : 600, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(`public/media/${outputPath.replace('.webp', '-thumb.webp')}`);
  return `/media/${outputPath}`;
}
const output = [];
for (const game of games) {
  const r = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${game.appId}&l=english`,
  );
  const body = await r.json();
  const data = body[game.appId]?.data;
  if (!data) throw new Error(`Missing ${game.name}`);
  const screenshots = await Promise.all(
    data.screenshots.slice(0, 6).map((s, i) => cache(s.path_full, `${game.id}-${i}.jpg`)),
  );
  let cover;
  try {
    cover = await cache(
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/library_600x900_2x.jpg`,
      `${game.id}-cover.jpg`,
    );
  } catch {
    cover = await cache(data.header_image, `${game.id}-cover.jpg`);
  }
  const movies = (data.movies || [])
    .map((m) => ({ name: m.name, url: m.hls_h264 || m.mp4?.max || m.webm?.max }))
    .filter((m) => m.url);
  output.push({
    ...game,
    cover,
    screenshots,
    movies,
    source: `https://store.steampowered.com/app/${game.appId}/`,
  });
  console.log(
    `${game.name}: ${screenshots.length} screenshots, ${movies.length} official video streams`,
  );
}
await writeFile('src/data/media.json', JSON.stringify(output, null, 2));
await writeFile(
  'public/media/SOURCES.json',
  JSON.stringify(
    {
      retrieved: new Date().toISOString(),
      note: 'Official publisher marketing artwork cached for this local prototype. Rights remain with the respective owners. Videos are streamed from the publisher’s Steam CDN, never stored locally.',
      games: output.map((g) => ({ name: g.name, source: g.source, movies: g.movies })),
    },
    null,
    2,
  ),
);
