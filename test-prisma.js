import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function test() {
  try {
    const hospital = await prisma.hospital.create({
      data: {
        code: 'TEST-' + randomUUID().slice(0, 8),
        name: 'Test Hospital',
        email: 'test@example.com',
        phone: '1234567890',
        city: 'Test City',
        province: 'Test Province',
        accountStatus: 'TRIALING',
      }
    });

    console.log('Hospital created:', hospital.id);

    const role = await prisma.hospitalRole.create({
      data: {
        hospitalId: hospital.id,
        key: 'test_admin',
        name: 'Test Admin',
        permissions: {
          create: [
            {
              hospitalId: hospital.id,
              featureKey: 'dashboard',
              canRead: true,
              canWrite: true,
              canManage: true,
            }
          ]
        }
      }
    });

    console.log('Role created:', role.id);

  } catch (error) {
    console.error('ERROR OCCURRED:');
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

test();
