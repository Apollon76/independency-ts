# Independency-TS

A TypeScript dependency injection (DI) container that operates in local scope with no global state. Inspired by [independency](https://github.com/Apollon76/independency) (Python).

## Features

- **Local Scope**: No global state - all containers must be explicitly created
- **Type Safety**: Full TypeScript support with type inference
- **Singleton & Transient**: Control instance lifetime
- **Factory Functions**: Support for custom factory functions
- **String/Symbol Keys**: Use strings or symbols as dependency keys
- **Testing Support**: `TestContainer` allows overriding dependencies for tests
- **Cycle Detection**: Detects circular dependencies at build time
- **Container Injection**: Container itself can be injected as a dependency

## Installation

```bash
npm install independency-ts reflect-metadata
```

## Requirements

- TypeScript 5.0+
- `reflect-metadata` for automatic type reflection
- Enable `experimentalDecorators` and `emitDecoratorMetadata` in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Quick Start

```typescript
import 'reflect-metadata';
import { ContainerBuilder, Injectable, Dependency as Dep } from 'independency-ts';

@Injectable()
class Database {
  constructor(public url: string) {}
}

@Injectable()
class UserService {
  constructor(public db: Database) {}
}

// Build container
const builder = new ContainerBuilder();

builder.singleton(
  Database,
  ({ url }) => new Database(url),
  { url: 'postgres://localhost' }
);

builder.singleton(
  UserService,
  ({ db }) => new UserService(db),
  { db: new Dep(Database) }
);

const container = builder.build();

// Resolve dependencies
const service = container.resolve(UserService);
console.log(service.db.url); // postgres://localhost
```

## Core Concepts

### Registration Types

**Singleton**: One instance shared across all resolutions
```typescript
builder.singleton(Database, () => new Database());
```

**Transient**: New instance created for each resolution
```typescript
builder.transient(Logger, () => new Logger());
```

### Dependency Keys

You can use classes, strings, or symbols as keys:

```typescript
// Class key
builder.singleton(Database, () => new Database());

// String key
builder.singleton('db-url', () => 'postgres://localhost');

// Symbol key
const ConfigKey = Symbol('Config');
builder.singleton(ConfigKey, () => ({ port: 3000 }));
```

### Explicit Dependencies

Use `Dependency` wrapper for explicit dependency injection:

```typescript
import { Dependency as Dep } from 'independency-ts';

builder.singleton('primary-db', () => new Database('primary'));
builder.singleton('cache-db', () => new Database('cache'));

builder.singleton(
  UserService,
  ({ db }) => new UserService(db),
  { db: new Dep('primary-db') } // Explicitly choose which DB
);
```

### Factory Functions

Support custom factory functions:

```typescript
function createDatabase(config: Config): Database {
  return new Database(config.url);
}

builder.singleton(Config, () => new Config());
builder.singleton(
  Database,
  ({ config }) => createDatabase(config),
  { config: new Dep(Config) }
);
```

### Container as Dependency

Inject the container itself for dynamic resolution:

```typescript
function createService(container: Container, config: Config): Service {
  const dbKey = config.dbType; // Decide at runtime
  return new Service(container.resolve(dbKey));
}

builder.singleton(
  Service,
  ({ container, config }) => createService(container, config),
  {
    container: new Dep(Container),
    config: new Dep(Config)
  }
);
```

## Testing

Use `TestContainer` to override dependencies in tests:

```typescript
const container = builder.build();

// Create test container with overrides
const testContainer = container
  .createTestContainer()
  .withOverriddenSingleton(Database, () => new MockDatabase());

// Original container unchanged
const realService = container.resolve(UserService);
const testService = testContainer.resolve(UserService);

expect(realService.db).toBeInstanceOf(Database);
expect(testService.db).toBeInstanceOf(MockDatabase);
```

## Advanced Examples

### Complex Dependency Graph

```typescript
@Injectable()
class Database {
  constructor(public url: string) {}
}

@Injectable()
class Repository {
  constructor(public db: Database) {}
}

@Injectable()
class Service {
  constructor(public repo: Repository) {}
}

@Injectable()
class Controller {
  constructor(public service: Service) {}
}

const builder = new ContainerBuilder();

builder.singleton(
  Database,
  ({ url }) => new Database(url),
  { url: 'postgres://localhost' }
);

builder.singleton(
  Repository,
  ({ db }) => new Repository(db),
  { db: new Dep(Database) }
);

builder.singleton(
  Service,
  ({ repo }) => new Service(repo),
  { repo: new Dep(Repository) }
);

builder.singleton(
  Controller,
  ({ service }) => new Controller(service),
  { service: new Dep(Service) }
);

const container = builder.build();
const controller = container.resolve(Controller);
```

### Multiple Configurations

```typescript
@Injectable()
class Logger {
  constructor(public name: string, public level: string) {}
}

const builder = new ContainerBuilder();

builder.singleton('appLogger', () => new Logger('app', 'info'));
builder.singleton('dbLogger', () => new Logger('database', 'debug'));

const container = builder.build();

const appLogger = container.resolve('appLogger');
const dbLogger = container.resolve('dbLogger');
```

## Error Handling

The container provides clear error messages:

```typescript
// Missing dependency
builder.singleton(UserService, ({ db }) => new UserService(db));
builder.build(); // Throws: No dependency of type Database needed by UserService

// Circular dependency
builder.singleton(A, ({ b }) => new A(b), { b: new Dep(B) });
builder.singleton(B, ({ a }) => new B(a), { a: new Dep(A) });
builder.build(); // Throws: Cycle dependencies for type A

// Already registered
builder.singleton(Database, () => new Database());
builder.singleton(Database, () => new Database());
// Throws: Type Database is already registered
```

## Design Principles

1. **No Global State**: All containers are explicitly created
2. **Type Safety**: Full TypeScript type inference
3. **Explicit Dependencies**: Clear dependency graph
4. **Fail Fast**: Build-time validation
5. **Testability**: Easy to override dependencies for testing

## Differences from Python Version

- Uses `reflect-metadata` for type reflection instead of Python's `get_type_hints`
- Generics are compile-time only (TypeScript limitation)
- Uses decorators (`@Injectable()`) for metadata emission
- Factory functions receive a single object parameter with named properties
- No native forward reference support (use string keys instead)

## API Reference

### ContainerBuilder

- `singleton<T>(key, factory, kwargs?)`: Register singleton
- `transient<T>(key, factory, kwargs?)`: Register transient
- `build()`: Build and validate container

### Container

- `resolve<T>(key)`: Resolve dependency
- `getRegisteredDeps()`: Get all registered keys
- `createTestContainer()`: Create test container

### TestContainer

- `withOverridden<T>(key, factory, isSingleton, kwargs?)`: Override dependency
- `withOverriddenSingleton<T>(key, factory, kwargs?)`: Override as singleton

### Dependency

- `new Dependency(key)`: Explicit dependency marker

## License

MIT
