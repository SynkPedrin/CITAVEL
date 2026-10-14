import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin, assertRequestMutation } from '@/lib/auth';
import { HttpError, readJson, newTemporaryPassword } from '@/lib/security';
import { assertUserRoleChange, userClientAssignments } from '@/lib/user-management';
import { userCreateSchema } from '@/lib/validation';
import { ok, fail } from '../_utils';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const actor = await requireAdmin();
    const users = await db.user.findMany({
      where: { memberships: { some: { organizationId: actor.organizationId } } },
      include: { memberships: true, clientUsers: { where: { client: { organizationId: actor.organizationId } }, include: { client: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return ok({ users: users.map(user => ({ id: user.id, name: user.name, email: user.email, status: user.status, mustChangePassword: user.mustChangePassword, role: user.memberships.find(m => m.organizationId === actor.organizationId)!.role, clients: user.clientUsers.map(item => item.client), sharedAccount: user.memberships.length > 1 })) });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    assertRequestMutation(request);
    const actor = await requireAdmin();
    const parsed = userCreateSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Revise os campos do usuário.', 'INVALID_USER');
    const body = parsed.data;
    assertUserRoleChange(actor, body.role);
    const clientIds = userClientAssignments(body.role, body.clientIds);
    const allowed = await db.client.count({ where: { id: { in: clientIds }, organizationId: actor.organizationId } });
    if (allowed !== clientIds.length) throw new HttpError(403, 'Selecione apenas clientes desta organização.', 'CLIENT_ASSIGNMENT_FORBIDDEN');
    const temporaryPassword = body.temporaryPassword || body.tempPassword || newTemporaryPassword();
    const user = await db.user.create({ data: {
      name: body.name, email: body.email, passwordHash: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: true,
      memberships: { create: { organizationId: actor.organizationId, role: body.role } },
      clientUsers: { create: clientIds.map(clientId => ({ clientId, role: body.role })) },
    } });
    return ok({ user: { id: user.id, name: user.name, email: user.email }, temporaryPassword: body.temporaryPassword || body.tempPassword ? undefined : temporaryPassword }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return fail(new HttpError(409, 'Não foi possível criar um acesso com este e-mail. Use outro endereço ou edite o acesso existente.', 'EMAIL_UNAVAILABLE'));
    return fail(error);
  }
}
