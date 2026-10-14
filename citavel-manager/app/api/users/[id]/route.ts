import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { requireAdmin, assertRequestMutation } from '@/lib/auth';
import { HttpError, readJson, newTemporaryPassword } from '@/lib/security';
import { assertUserRoleChange, userClientAssignments } from '@/lib/user-management';
import { userUpdateSchema } from '@/lib/validation';
import { ok, fail } from '../../_utils';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request);
    const actor = await requireAdmin();
    const { id } = await params;
    const parsed = userUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Revise os campos do usuário.', 'INVALID_USER');
    const body = parsed.data;
    const target = await db.user.findFirst({ where: { id, memberships: { some: { organizationId: actor.organizationId } } }, include: { memberships: true, clientUsers: { where: { client: { organizationId: actor.organizationId } } } } });
    if (!target) throw new HttpError(404, 'Usuário não encontrado nesta organização.', 'USER_NOT_FOUND');
    const membership = target.memberships.find(item => item.organizationId === actor.organizationId)!;
    assertUserRoleChange(actor, body.role, { id, role: membership.role, organizationIds: target.memberships.map(item => item.organizationId) }, body.status);
    if (body.resetPassword && id === actor.id) throw new HttpError(400, 'Use Minha conta para trocar sua própria senha.', 'SELF_PASSWORD_RESET');
    const role = body.role || membership.role;
    const clientIds = userClientAssignments(role, body.clientIds ?? target.clientUsers.map(item => item.clientId));
    const allowed = await db.client.count({ where: { id: { in: clientIds }, organizationId: actor.organizationId } });
    if (allowed !== clientIds.length) throw new HttpError(403, 'Selecione apenas clientes desta organização.', 'CLIENT_ASSIGNMENT_FORBIDDEN');
    const temporaryPassword = body.resetPassword ? newTemporaryPassword() : undefined;
    const passwordHash = temporaryPassword ? await bcrypt.hash(temporaryPassword, 12) : undefined;
    const assignmentsChanged = JSON.stringify([...clientIds].sort()) !== JSON.stringify(target.clientUsers.map(item => item.clientId).sort());
    await db.$transaction(async transaction => {
      await transaction.user.update({ where: { id }, data: { name: body.name, status: body.status, passwordHash, mustChangePassword: temporaryPassword ? true : undefined } });
      if (body.role) await transaction.membership.update({ where: { organizationId_userId: { organizationId: actor.organizationId, userId: id } }, data: { role } });
      if (body.clientIds || body.role) {
        await transaction.clientUser.deleteMany({ where: { userId: id, client: { organizationId: actor.organizationId } } });
        await transaction.clientUser.createMany({ data: clientIds.map(clientId => ({ userId: id, clientId, role })), skipDuplicates: true });
      }
      if (body.status === 'DISABLED' || temporaryPassword || role !== membership.role || assignmentsChanged) await transaction.session.deleteMany({ where: { userId: id } });
      if (temporaryPassword) await transaction.loginAttempt.deleteMany({ where: { identifier: target.email } });
    });
    return ok({ ok: true, temporaryPassword });
  } catch (error) { return fail(error); }
}
