import dotenv from 'dotenv';
dotenv.config();

import { startBot } from './bot';
import { startRemnawaveApi } from './remnawave-api';
import { startWebApi } from './web-api';

console.log('─────────────────────────────');
console.log('  MTProxy Control Panel');
console.log('─────────────────────────────');

startBot();
startRemnawaveApi();
startWebApi();


