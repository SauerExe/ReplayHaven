import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
const media = JSON.parse(await readFile('src/data/media.json', 'utf8'));
for (const game of media) {
  for (const src of [...game.screenshots, game.cover]) {
    if (!src.endsWith('.jpg')) continue;
    await sharp(`public${src}`)
      .resize({ width: src.includes('cover') ? 600 : 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(`public${src.replace('.jpg', '.webp')}`);
    await sharp(`public${src}`)
      .resize({ width: src.includes('cover') ? 400 : 600, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(`public${src.replace('.jpg', '-thumb.webp')}`);
  }
  game.screenshots = game.screenshots.map((p) => p.replace('.jpg', '.webp'));
  game.cover = game.cover.replace('.jpg', '.webp');
}
await writeFile('src/data/media.json', JSON.stringify(media, null, 2));
console.log('Responsive WebP artwork generated.');
