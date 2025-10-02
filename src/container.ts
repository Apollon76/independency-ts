import 'reflect-metadata';

// Type definitions
export type Constructor<T = any> = new (...args: any[]) => T;
export type Factory<T = any> = (...args: any[]) => T;
export type ServiceKey<T = any> = string | symbol | Constructor<T>;

// Custom error class
export class ContainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerError';
  }
}

// Dependency wrapper for explicit dependency injection
export class Dependency<T = any> {
  constructor(public readonly key: ServiceKey<T>) {}
}

// Registration information
interface Registration<T = any> {
  key: ServiceKey<T>;
  factory: Factory<T>;
  isSingleton: boolean;
  kwargs: Record<string, any>;
  originalConstructor?: Constructor<T>; // Store original constructor for auto-resolution
}

// Check if a function is a constructor (class)
function isConstructor(func: any): func is Constructor {
  if (typeof func !== 'function') return false;

  // Check if it's a class by looking at its prototype
  // Classes have a prototype with a constructor property
  const funcStr = func.toString();
  return funcStr.startsWith('class ') || (
    func.prototype &&
    func.prototype.constructor === func &&
    Object.getOwnPropertyNames(func.prototype).length > 1
  );
}

// Create an auto-resolving factory from a constructor
function createAutoFactory<T>(constructor: Constructor<T>): Factory<T> {
  return (deps: Record<string, any>) => {
    const paramTypes = getParameterTypes(constructor);
    const args = paramTypes.map((paramType, index) => {
      // Get the parameter name from the constructor
      const paramNames = getParameterNames(constructor);
      const paramName = paramNames[index];

      if (paramName && paramName in deps) {
        return deps[paramName];
      }

      // This shouldn't happen if dependencies are resolved correctly
      throw new ContainerError(
        `Cannot resolve parameter ${index} (${paramName || 'unknown'}) for ${constructor.name}`
      );
    });

    return new constructor(...args);
  };
}

// Get constructor parameter types using reflect-metadata
function getParameterTypes(target: any): any[] {
  if (typeof target !== 'function') {
    throw new ContainerError(`Cannot get parameter types from non-function: ${typeof target}`);
  }
  return Reflect.getMetadata('design:paramtypes', target) || [];
}

// Get parameter names from function
function getParameterNames(func: Function): string[] {
  const fnStr = func.toString().replace(/\/\*[\s\S]*?\*\//g, ''); // Remove block comments
  const match = fnStr.match(/\(([^)]*)\)/);
  if (!match) return [];

  const paramStr = match[1].trim();

  // Handle destructuring pattern like ({ x, y })
  if (paramStr.startsWith('{') && paramStr.includes('}')) {
    const destructureMatch = paramStr.match(/\{([^}]+)\}/);
    if (destructureMatch) {
      const props = destructureMatch[1].split(',').map(p => {
        const cleaned = p.trim().split(':')[0].trim(); // Remove type annotations
        return cleaned;
      });
      return props.filter(p => p && p !== '');
    }
  }

  const params = match[1].split(',').map(p => {
    const cleaned = p.trim().split('=')[0].trim(); // Remove default values
    const paramName = cleaned.split(':')[0].trim(); // Remove type annotations
    return paramName;
  });

  return params.filter(p => p && p !== '');
}

// Get dependencies from registration
function getDependencies(
  registration: Registration,
  localRegistry: Map<string, ServiceKey>
): Map<string, ServiceKey> {
  const deps = new Map<string, ServiceKey>();

  // Use original constructor for auto-resolution if available
  const targetForReflection = registration.originalConstructor || registration.factory;
  const paramTypes = getParameterTypes(targetForReflection);
  const paramNames = getParameterNames(targetForReflection);

  for (let i = 0; i < paramNames.length; i++) {
    const paramName = paramNames[i];

    // Skip if already provided in kwargs
    if (paramName in registration.kwargs) {
      // Check if it's a Dependency wrapper
      const value = registration.kwargs[paramName];
      if (value instanceof Dependency) {
        deps.set(paramName, value.key);
      }
      continue;
    }

    // Get type from metadata
    const paramType = paramTypes[i];
    if (paramType) {
      // Check if type is registered in localRegistry (for forward refs)
      const registeredKey = localRegistry.get(paramType.name) || paramType;
      deps.set(paramName, registeredKey);
    } else {
      // No type metadata available - try to resolve by parameter name
      // This handles cases like ({ a }) => new B(a) without explicit kwargs
      const registeredKey = localRegistry.get(paramName);
      if (registeredKey) {
        deps.set(paramName, registeredKey);
      } else {
        // Assume the parameter name itself is the key (e.g., string key)
        deps.set(paramName, paramName);
      }
    }
  }

  return deps;
}

// Resolve constants from kwargs
function resolveConstants(kwargs: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(kwargs)) {
    if (!(value instanceof Dependency)) {
      result[key] = value;
    }
  }
  return result;
}

// Validate registration
function validateRegistration(
  key: ServiceKey,
  factory: Factory,
  kwargs: Record<string, any>
): void {
  const paramNames = getParameterNames(factory);
  for (const kwargName of Object.keys(kwargs)) {
    if (!paramNames.includes(kwargName)) {
      throw new ContainerError(`No argument '${kwargName}' for factory for type ${String(key)}`);
    }
  }

  // If multiple kwargs are provided and none are Dependencies, this is likely an error
  // since you're not doing any dependency injection
  const kwargKeys = Object.keys(kwargs);
  if (kwargKeys.length > 1) {
    const hasDependency = kwargKeys.some(k => kwargs[k] instanceof Dependency);
    if (!hasDependency) {
      throw new ContainerError(
        `Multiple kwargs provided but none are Dependencies for type ${String(key)}. ` +
        `If providing multiple parameters, at least one should be a Dependency.`
      );
    }
  }
}

// Normalize key to string for internal storage
function normalizeKey(key: ServiceKey): string {
  if (typeof key === 'string') return key;
  if (typeof key === 'symbol') return key.toString();
  return key.name || String(key);
}

// Main Container class
export class Container {
  protected registry: Map<string, Registration>;
  protected localRegistry: Map<string, ServiceKey>; // Maps type names to actual keys
  protected resolved: Map<string, any>;

  constructor(
    registry: Map<string, Registration>,
    localRegistry: Map<string, ServiceKey>
  ) {
    this.registry = registry;
    this.localRegistry = localRegistry;
    this.resolved = new Map();
  }

  getRegisteredDeps(): Set<ServiceKey> {
    const keys = new Set<ServiceKey>();
    for (const reg of this.registry.values()) {
      keys.add(reg.key);
    }
    return keys;
  }

  resolve<T>(key: ServiceKey<T>): T {
    const normalizedKey = normalizeKey(key);

    // Check if already resolved singleton
    if (this.resolved.has(normalizedKey)) {
      return this.resolved.get(normalizedKey);
    }

    // Get registration
    const registration = this.registry.get(normalizedKey);
    if (!registration) {
      throw new ContainerError(`No dependency of type ${String(key)}`);
    }

    // Resolve dependencies
    const args: Record<string, any> = resolveConstants(registration.kwargs);
    const deps = getDependencies(registration, this.localRegistry);

    for (const [paramName, depKey] of deps.entries()) {
      args[paramName] = this.resolve(depKey);
    }

    // Create instance
    const result = registration.factory(args);

    // Cache if singleton
    if (registration.isSingleton) {
      this.resolved.set(normalizedKey, result);
    }

    return result;
  }

  createTestContainer(): TestContainer {
    const registryCopy = new Map(this.registry);
    const localRegistryCopy = new Map(this.localRegistry);

    const testContainer = new TestContainer(registryCopy, localRegistryCopy);

    // Register the test container itself
    registryCopy.set(normalizeKey(Container), {
      key: Container,
      factory: () => testContainer,
      isSingleton: true,
      kwargs: {},
    });
    localRegistryCopy.set('Container', Container);

    return testContainer;
  }
}

// TestContainer with override capabilities
export class TestContainer extends Container {
  withOverridden<T>(
    key: ServiceKey<T>,
    factory: Factory<T>,
    isSingleton: boolean,
    kwargs: Record<string, any> = {}
  ): TestContainer {
    const normalizedKey = normalizeKey(key);

    if (!this.registry.has(normalizedKey)) {
      throw new ContainerError('Cannot override class without any registration');
    }

    validateRegistration(key, factory, kwargs);

    const registryCopy = new Map(this.registry);
    const localRegistryCopy = new Map(this.localRegistry);

    registryCopy.set(normalizedKey, {
      key,
      factory,
      isSingleton,
      kwargs,
    });

    const testContainer = new TestContainer(registryCopy, localRegistryCopy);

    // Update Container reference
    registryCopy.set(normalizeKey(Container), {
      key: Container,
      factory: () => testContainer,
      isSingleton: true,
      kwargs: {},
    });

    return testContainer;
  }

  withOverriddenSingleton<T>(
    key: ServiceKey<T>,
    factory: Factory<T>,
    kwargs: Record<string, any> = {}
  ): TestContainer {
    return this.withOverridden(key, factory, true, kwargs);
  }
}

// ContainerBuilder for constructing containers
export class ContainerBuilder {
  private registry: Map<string, Registration>;
  private localRegistry: Map<string, ServiceKey>;

  constructor() {
    this.registry = new Map();
    this.localRegistry = new Map();
  }

  build(): Container {
    const registryCopy = new Map(this.registry);
    const localRegistryCopy = new Map(this.localRegistry);

    const container = new Container(registryCopy, localRegistryCopy);

    // Register container itself
    registryCopy.set(normalizeKey(Container), {
      key: Container,
      factory: () => container,
      isSingleton: true,
      kwargs: {},
    });
    localRegistryCopy.set('Container', Container);

    // Validate all dependencies are resolvable
    this.checkResolvable(registryCopy, localRegistryCopy);

    return container;
  }

  register<T>(
    key: ServiceKey<T>,
    factory: Factory<T> | Constructor<T>,
    options: { isSingleton: boolean; kwargs?: Record<string, any> }
  ): void {
    const normalizedKey = normalizeKey(key);

    if (this.registry.has(normalizedKey)) {
      throw new ContainerError(`Type ${String(key)} is already registered`);
    }

    const kwargs = options.kwargs || {};

    // If factory is a constructor, create an auto-resolving factory
    let actualFactory: Factory<T>;
    let originalConstructor: Constructor<T> | undefined;
    if (isConstructor(factory)) {
      actualFactory = createAutoFactory(factory);
      originalConstructor = factory;
    } else {
      actualFactory = factory;
      validateRegistration(key, factory, kwargs);
    }

    this.registry.set(normalizedKey, {
      key,
      factory: actualFactory,
      isSingleton: options.isSingleton,
      kwargs,
      originalConstructor,
    });

    // Update local registry for type name lookup
    if (typeof key === 'function') {
      this.localRegistry.set(key.name, key);
    }
  }

  singleton<T>(key: ServiceKey<T>, factory: Factory<T> | Constructor<T>, kwargs: Record<string, any> = {}): void {
    this.register(key, factory, { isSingleton: true, kwargs });
  }

  transient<T>(key: ServiceKey<T>, factory: Factory<T> | Constructor<T>, kwargs: Record<string, any> = {}): void {
    this.register(key, factory, { isSingleton: false, kwargs });
  }

  private checkResolvable(
    registry: Map<string, Registration>,
    localRegistry: Map<string, ServiceKey>
  ): void {
    const resolved = new Set<string>();

    for (const [key] of registry) {
      this.checkResolution(key, resolved, new Set(), registry, localRegistry, null);
    }
  }

  private checkResolution(
    key: string,
    resolved: Set<string>,
    resolving: Set<string>,
    registry: Map<string, Registration>,
    localRegistry: Map<string, ServiceKey>,
    parent: string | null
  ): void {
    if (resolved.has(key)) {
      return;
    }

    if (resolving.has(key)) {
      throw new ContainerError(`Cycle dependencies for type ${key}`);
    }

    resolving.add(key);

    const registration = registry.get(key);
    if (!registration) {
      throw new ContainerError(
        `No dependency of type ${key}${parent ? ` needed by ${parent}` : ''}`
      );
    }

    const deps = getDependencies(registration, localRegistry);
    for (const depKey of deps.values()) {
      const normalizedDepKey = normalizeKey(depKey);
      this.checkResolution(normalizedDepKey, resolved, resolving, registry, localRegistry, key);
    }

    resolving.delete(key);
    resolved.add(key);
  }
}

// Helper decorator for automatic dependency injection
// NOTE: This decorator is required for TypeScript to emit parameter type metadata.
// Without it, you must provide explicit kwargs with Dependency objects.
export function Injectable() {
  return function <T extends Constructor>(target: T) {
    return target;
  };
}
