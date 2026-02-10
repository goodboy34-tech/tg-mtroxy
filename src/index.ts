import dotenv from 'dotenv';
dotenv.config();

import { startBot } from './bot';

console.log('═══════════════════════════════════════');
console.log('  MTProxy Management System');
console.log('  Control Panel');
console.log('═══════════════════════════════════════');

startBot();
