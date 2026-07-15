import '../config/env.js';
import { PrismaClient } from '@prisma/client';

const globalKey = '__aiFinoraPrisma';

export const prisma = globalThis[globalKey] || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalThis[globalKey] = prisma;
