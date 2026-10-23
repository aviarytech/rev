import { writeFile } from 'node:fs/promises';
import { route } from './route.js';
await writeFile(process.argv[2], JSON.stringify({ anonymous: route(null), authenticated: route({ user: 'alice' }) }, null, 2));
