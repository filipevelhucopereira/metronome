import { access, copyFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const outputDir = path.resolve(process.argv[2] ?? 'dist/metronome-pwa/browser');
const indexPath = path.join(outputDir, 'index.html');
const notFoundPath = path.join(outputDir, '404.html');
const noJekyllPath = path.join(outputDir, '.nojekyll');

await access(indexPath, constants.F_OK);
await copyFile(indexPath, notFoundPath);
await writeFile(noJekyllPath, '');

console.log(`Prepared GitHub Pages artifacts in ${outputDir}`);
