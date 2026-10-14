import { Actor, HttpError, Role } from './security';

export function assertUserRoleChange(actor: Actor, requestedRole?: Role, target?: { id: string; role: Role; organizationIds: string[] }, requestedStatus?: string) {
  if (target && (target.organizationIds.length !== 1 || target.organizationIds[0] !== actor.organizationId)) {
    throw new HttpError(403, 'Este acesso não pode ser alterado nesta organização.', 'USER_ORGANIZATION_FORBIDDEN');
  }
  if (actor.role !== 'SUPER_ADMIN' && (requestedRole === 'SUPER_ADMIN' || target?.role === 'SUPER_ADMIN')) {
    throw new HttpError(403, 'Somente um super administrador pode gerenciar este perfil.', 'ROLE_FORBIDDEN');
  }
  if (target?.id === actor.id && (requestedStatus === 'DISABLED' || (requestedRole && requestedRole !== target.role))) {
    throw new HttpError(400, 'Mantenha seu próprio acesso ativo e com o mesmo perfil.', 'SELF_LOCKOUT');
  }
}

export function userClientAssignments(role: Role, suppliedIds: string[]) {
  const clientIds = [...new Set(suppliedIds)];
  if (role.startsWith('CLIENT_') && !clientIds.length) {
    throw new HttpError(400, 'Selecione pelo menos um cliente para esse perfil.', 'CLIENT_ASSIGNMENT_REQUIRED');
  }
  return role.startsWith('CLIENT_') ? clientIds : [];
}
