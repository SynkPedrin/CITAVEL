import bcrypt from 'bcryptjs';
import { db } from '../lib/db';
import { syncEngineClient } from '../lib/sync';
import { emailSchema, passwordSchema } from '../lib/validation';

const email = emailSchema.parse(process.env.SEED_ADMIN_EMAIL || 'admin@citavel.local');
const resetPassword = process.argv.includes('--reset-admin-password');

try {
  const existing = await db.user.findUnique({ where: { email } });
  let passwordHash: string | undefined;
  if (!existing || resetPassword) {
    const parsed = passwordSchema.safeParse(process.env.SEED_ADMIN_PASSWORD);
    if (!parsed.success) throw new Error('Configure uma senha válida em SEED_ADMIN_PASSWORD no .env.local privado.');
    passwordHash = await bcrypt.hash(parsed.data, 12);
  }

  const org = await db.organization.upsert({
    where: { slug: 'citavel' },
    create: { name: 'CITÁVEL', slug: 'citavel' },
    update: {},
  });
  const user = await db.$transaction(async transaction => {
    const admin = existing
      ? passwordHash
        ? await transaction.user.update({ where: { email }, data: { passwordHash, mustChangePassword: false } })
        : existing
      : await transaction.user.create({ data: { name: 'Administrador CITÁVEL', email, passwordHash: passwordHash! } });
    if (existing && resetPassword) {
      await transaction.session.deleteMany({ where: { userId: admin.id } });
      await transaction.loginAttempt.deleteMany({ where: { identifier: email } });
    }
    await transaction.membership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: admin.id } },
      create: { organizationId: org.id, userId: admin.id, role: 'SUPER_ADMIN' },
      update: {},
    });
    return admin;
  });

  try {
    await syncEngineClient('cosentino', org.id);
  } catch {
    console.warn('O acesso está pronto. A sincronização da Cosentino ficará disponível quando o Engine responder.');
  }
  console.log(`Seed concluído para ${user.email}. ${existing && !resetPassword ? 'A senha existente foi preservada.' : 'A senha da configuração privada foi aplicada.'}`);
} finally {
  await db.$disconnect();
}
