import { RequestMethod, type Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import type { TestingModule } from '@nestjs/testing';
import { UNGUARDED_UNSAFE_ROUTE } from '../../src/auth/auth.decorators.js';
import { CsrfGuard, SessionGuard } from '../../src/auth/guards.js';
import { IDEMPOTENT_METADATA } from '../../src/common/idempotency/idempotent.decorator.js';

export interface DiscoveredHandler {
  controller: Type<unknown>;
  name: string;
  handler: (...args: unknown[]) => unknown;
  method: RequestMethod;
  unsafe: boolean;
  /** Effective guard order: controller-level guards run before handler-level guards. */
  guards: unknown[];
  idempotent: boolean;
  allowlistReason: string | undefined;
}

const UNSAFE = new Set<RequestMethod>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
  RequestMethod.ALL,
]);

/** Every controller class registered anywhere in the compiled module graph. */
export function discoverControllers(moduleRef: TestingModule): Type<unknown>[] {
  const out = new Set<Type<unknown>>();
  for (const mod of moduleRef.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      if (wrapper.metatype) out.add(wrapper.metatype as Type<unknown>);
    }
  }
  return [...out];
}

/** All route handlers of a controller, including inherited ones (walks the prototype chain). */
export function discoverHandlers(controller: Type<unknown>): DiscoveredHandler[] {
  const out: DiscoveredHandler[] = [];
  const seen = new Set<string>();
  for (
    let proto = controller.prototype as object | null;
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || seen.has(name)) continue;
      seen.add(name);
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      const handler = descriptor?.value as unknown;
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      const guards = [
        ...((Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined) ?? []),
        ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? []),
      ];
      out.push({
        controller,
        name,
        handler: handler as (...args: unknown[]) => unknown,
        method,
        unsafe: UNSAFE.has(method),
        guards,
        idempotent: Reflect.getMetadata(IDEMPOTENT_METADATA, handler) === true,
        allowlistReason:
          (Reflect.getMetadata(UNGUARDED_UNSAFE_ROUTE, handler) as string | undefined) ??
          (Reflect.getMetadata(UNGUARDED_UNSAFE_ROUTE, controller) as string | undefined),
      });
    }
  }
  return out;
}

/**
 * Security gate L-4: every unsafe handler must run `SessionGuard` before `CsrfGuard`, unless it
 * carries `@AllowUnguardedUnsafeRoute(reason)`. Returns human-readable violations.
 */
export function unsafeHandlerViolations(handlers: DiscoveredHandler[]): string[] {
  const violations: string[] = [];
  for (const h of handlers) {
    if (!h.unsafe || h.allowlistReason) continue;
    const id = `${h.controller.name}.${h.name}`;
    const s = h.guards.indexOf(SessionGuard);
    const c = h.guards.indexOf(CsrfGuard);
    if (h.guards.length === 0) violations.push(`${id}: no guards at all`);
    else if (s === -1) violations.push(`${id}: missing SessionGuard`);
    else if (c === -1) violations.push(`${id}: missing CsrfGuard`);
    else if (s > c) violations.push(`${id}: CsrfGuard runs before SessionGuard`);
  }
  return violations;
}
