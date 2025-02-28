import { CompoundEntityRef, parseEntityRef } from '@backstage/catalog-model';
import { AuthorizeResult } from '@backstage/plugin-permission-common';

import {
  Role,
  RoleBasedPolicy,
  Source,
} from '@janus-idp/backstage-plugin-rbac-common';

import { RoleMetadataStorage } from '../database/role-metadata';

export function validatePolicy(policy: RoleBasedPolicy): Error | undefined {
  const err = validateEntityReference(policy.entityReference);
  if (err) {
    return err;
  }

  if (!policy.permission) {
    return new Error(`'permission' field must not be empty`);
  }

  if (!policy.policy) {
    return new Error(`'policy' field must not be empty`);
  }

  if (!policy.effect) {
    return new Error(`'effect' field must not be empty`);
  } else if (!isValidEffectValue(policy.effect)) {
    return new Error(
      `'effect' has invalid value: '${
        policy.effect
      }'. It should be: '${AuthorizeResult.ALLOW.toLocaleLowerCase()}' or '${AuthorizeResult.DENY.toLocaleLowerCase()}'`,
    );
  }

  return undefined;
}

export function validateRole(role: Role): Error | undefined {
  if (!role.name) {
    return new Error(`'name' field must not be empty`);
  }

  let err = validateEntityReference(role.name, true);
  if (err) {
    return err;
  }

  if (!role.memberReferences || role.memberReferences.length === 0) {
    return new Error(`'memberReferences' field must not be empty`);
  }

  for (const member of role.memberReferences) {
    err = validateEntityReference(member);
    if (err) {
      return err;
    }
  }
  return undefined;
}

function isValidEffectValue(effect: string): boolean {
  return (
    effect === AuthorizeResult.ALLOW.toLocaleLowerCase() ||
    effect === AuthorizeResult.DENY.toLocaleLowerCase()
  );
}

// We supports only full form entity reference: [<kind>:][<namespace>/]<name>
export function validateEntityReference(
  entityRef?: string,
  role?: boolean,
): Error | undefined {
  if (!entityRef) {
    return new Error(`'entityReference' must not be empty`);
  }

  let entityRefCompound: CompoundEntityRef;
  try {
    entityRefCompound = parseEntityRef(entityRef);
  } catch (err) {
    return err as Error;
  }

  const entityRefFull = `${entityRefCompound.kind}:${entityRefCompound.namespace}/${entityRefCompound.name}`;
  if (entityRefFull !== entityRef) {
    return new Error(
      `entity reference '${entityRef}' does not match the required format [<kind>:][<namespace>/]<name>. Provide, please, full entity reference.`,
    );
  }

  if (role && entityRefCompound.kind !== 'role') {
    return new Error(
      `Unsupported kind ${entityRefCompound.kind}. Supported value should be "role"`,
    );
  }

  if (
    entityRefCompound.kind !== 'user' &&
    entityRefCompound.kind !== 'group' &&
    entityRefCompound.kind !== 'role'
  ) {
    return new Error(
      `Unsupported kind ${entityRefCompound.kind}. List supported values ["user", "group", "role"]`,
    );
  }

  return undefined;
}

async function validateGroupingPolicy(
  groupPolicy: string[],
  preDefinedPoliciesFile: string,
  roleMetadataStorage: RoleMetadataStorage,
  source: Source,
) {
  if (groupPolicy.length !== 2) {
    throw new Error(`Group policy should has length 2`);
  }

  const member = groupPolicy[0];
  let err = validateEntityReference(member);
  if (err) {
    throw new Error(
      `Failed to validate group policy ${groupPolicy} from file ${preDefinedPoliciesFile}. Cause: ${err.message}`,
    );
  }
  const parent = groupPolicy[1];
  err = validateEntityReference(parent);
  if (err) {
    throw new Error(
      `Failed to validate group policy ${groupPolicy} from file ${preDefinedPoliciesFile}. Cause: ${err.message}`,
    );
  }
  if (member.startsWith(`role:`)) {
    throw new Error(
      `Group policy is invalid: ${groupPolicy}. rbac-backend plugin doesn't support role inheritance.`,
    );
  }
  if (member.startsWith(`group:`) && parent.startsWith(`group:`)) {
    throw new Error(
      `Group policy is invalid: ${groupPolicy}. Group inheritance information could be provided only with help of Catalog API.`,
    );
  }
  if (member.startsWith(`user:`) && parent.startsWith(`group:`)) {
    throw new Error(
      `Group policy is invalid: ${groupPolicy}. User membership information could be provided only with help of Catalog API.`,
    );
  }

  const metadata = await roleMetadataStorage.findRoleMetadata(parent);
  if (metadata && metadata.source !== source && metadata.source !== 'legacy') {
    throw new Error(
      `You could not add user or group to the role created with source ${metadata.source}`,
    );
  }
}

export async function validateAllPredefinedPolicies(
  policies: string[][],
  groupPolicies: string[][],
  preDefinedPoliciesFile: string,
  roleMetadataStorage: RoleMetadataStorage,
): Promise<void> {
  for (const policy of policies) {
    const err = validateEntityReference(policy[0]);
    if (err) {
      throw new Error(
        `Failed to validate policy from file ${preDefinedPoliciesFile}. Cause: ${err.message}`,
      );
    }
  }

  for (const groupPolicy of groupPolicies) {
    await validateGroupingPolicy(
      groupPolicy,
      preDefinedPoliciesFile,
      roleMetadataStorage,
      `csv-file`,
    );
  }
}
