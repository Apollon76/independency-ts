import 'reflect-metadata';
import {
  Container,
  ContainerBuilder,
  ContainerError,
  Dependency as Dep,
  Injectable,
} from './container';

describe('Container', () => {
  it('should resolve basic dependencies', () => {
    @Injectable()
    class A {
      constructor(public x: number, public y: string) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton('number', () => 1);
    builder.singleton('y', () => 'abacaba');
    builder.singleton(A, ({ x, y }) => new A(x, y), {
      x: new Dep('number'),
      y: new Dep('y'),
    });

    const container = builder.build();
    const inst = container.resolve(A);

    expect(inst).toBeInstanceOf(A);
    expect(inst.x).toBe(1);
    expect(inst.y).toBe('abacaba');
  });

  it('should support string keys', () => {
    const builder = new ContainerBuilder();
    builder.singleton('foo', () => 42);

    const container = builder.build();
    expect(container.resolve('foo')).toBe(42);
  });

  it('should differentiate between singleton and transient', () => {
    @Injectable()
    class A {}

    @Injectable()
    class B {}

    const builder = new ContainerBuilder();
    builder.transient(A, () => new A());
    builder.singleton(B, () => new B());

    const container = builder.build();

    expect(container.resolve(A)).not.toBe(container.resolve(A));
    expect(container.resolve(B)).toBe(container.resolve(B));
  });

  it('should throw on missing dependencies', () => {
    @Injectable()
    class A {}

    @Injectable()
    class B {
      constructor(public a: A) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton(B, ({ a }) => new B(a));

    expect(() => builder.build()).toThrow(ContainerError);
  });

  it('should detect cyclic dependencies', () => {
    @Injectable()
    class A {
      constructor(public b: any) {}
    }

    @Injectable()
    class B {
      constructor(public a: A) {}
    }

    const builder = new ContainerBuilder();
    builder.transient(A, ({ b }) => new A(b), { b: new Dep(B) });
    builder.transient(B, ({ a }) => new B(a), { a: new Dep(A) });

    expect(() => builder.build()).toThrow(ContainerError);
    expect(() => builder.build()).toThrow(/Cycle/);
  });

  it('should support factory functions', () => {
    @Injectable()
    class Database {
      constructor(public dsn: string) {}
    }

    function createDb(config: { dsn: string }): Database {
      return new Database(config.dsn);
    }

    const builder = new ContainerBuilder();
    builder.singleton('config', () => ({ dsn: 'postgresql://localhost' }));
    builder.singleton(Database, ({ config }) => createDb(config), {
      config: new Dep('config'),
    });

    const container = builder.build();
    const db = container.resolve(Database);

    expect(db.dsn).toBe('postgresql://localhost');
  });

  it('should get all registered dependencies', () => {
    @Injectable()
    class A {}

    const builder = new ContainerBuilder();
    builder.singleton(A, () => new A());
    builder.singleton('foo', () => 123);

    const container = builder.build();
    const deps = container.getRegisteredDeps();

    expect(deps.size).toBe(3); // A, 'foo', Container
    expect(deps.has(A)).toBe(true);
    expect(deps.has('foo')).toBe(true);
    expect(deps.has(Container)).toBe(true);
  });

  it('should throw when registering the same type twice', () => {
    const builder = new ContainerBuilder();
    builder.singleton('number', () => 1);

    expect(() => builder.singleton('number', () => 2)).toThrow(ContainerError);
  });

  it('should throw on invalid kwargs', () => {
    @Injectable()
    class A {
      constructor(public x: number) {}
    }

    const builder = new ContainerBuilder();

    expect(() => {
      builder.singleton(A, ({ x }: any) => new A(x), { x: 1, y: 1 });
    }).toThrow(ContainerError);
  });

  it('should support explicit dependencies with Dep', () => {
    @Injectable()
    class Database {
      constructor(public id: string) {}
    }

    @Injectable()
    class Service {
      constructor(public db: Database) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton('special_db', () => new Database('special'));
    builder.singleton(Service, ({ db }) => new Service(db), {
      db: new Dep('special_db'),
    });

    const container = builder.build();
    const service = container.resolve(Service);

    expect(service.db.id).toBe('special');
  });

  it('should not affect original container after building', () => {
    @Injectable()
    class A {}

    @Injectable()
    class B {}

    const builder = new ContainerBuilder();
    builder.singleton(A, () => new A());

    const container = builder.build();

    expect(() => container.resolve(B)).toThrow(ContainerError);

    builder.singleton(B, () => new B());

    expect(() => container.resolve(B)).toThrow(ContainerError);
  });

  it('should inject Container as dependency', () => {
    @Injectable()
    class Settings {
      constructor(public mapping: Record<string, any>) {}
    }

    @Injectable()
    class A {
      constructor(public x: any) {}
    }

    function makeA(container: Container, settings: Settings): A {
      return new A(container.resolve(settings.mapping['key']));
    }

    const builder = new ContainerBuilder();
    builder.singleton('number', () => 42);
    builder.singleton(Settings, () => new Settings({ key: 'number' }));
    builder.singleton(A, ({ container, settings }) => makeA(container, settings), {
      container: new Dep(Container),
      settings: new Dep(Settings),
    });

    const container = builder.build();
    const a = container.resolve(A);

    expect(a.x).toBe(42);
  });
});

describe('TestContainer', () => {
  it('should override dependencies', () => {
    @Injectable()
    class A {
      constructor(public x: number, public y: string) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton('number', () => 1);
    builder.singleton('y', () => 'abacaba');
    builder.singleton(A, ({ x, y }) => new A(x, y), {
      x: new Dep('number'),
      y: new Dep('y'),
    });

    const container = builder.build();
    const testContainer = container
      .createTestContainer()
      .withOverriddenSingleton('number', () => 2);

    const original = container.resolve(A);
    const overridden = testContainer.resolve(A);

    expect(original).not.toBe(overridden);
    expect(original.x).toBe(1);
    expect(overridden.x).toBe(2);
  });

  it('should throw when overriding missing dependency', () => {
    const builder = new ContainerBuilder();
    const container = builder.build();

    expect(() => {
      container.createTestContainer().withOverriddenSingleton('number', () => 1);
    }).toThrow(ContainerError);
  });

  it('should properly handle Container injection in test container', () => {
    @Injectable()
    class A {
      constructor(public x: number) {}
    }

    function makeA(container: Container): A {
      return new A(container.resolve('number') as number);
    }

    const builder = new ContainerBuilder();
    builder.singleton('number', () => 1);
    builder.singleton(A, ({ container }) => makeA(container), {
      container: new Dep(Container),
    });

    const container = builder.build();
    const testContainer = container
      .createTestContainer()
      .withOverriddenSingleton('number', () => 2);

    expect(container.resolve(A).x).toBe(1);
    expect(testContainer.resolve(A).x).toBe(2);
  });
});

describe('Automatic dependency resolution', () => {
  it('should auto-resolve dependencies from constructor types', () => {
    @Injectable()
    class A {
      constructor() {}
    }

    @Injectable()
    class B {
      constructor() {}
    }

    @Injectable()
    class C {
      constructor(public first: A, public second: B) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton(A, A);
    builder.singleton(B, B);
    builder.singleton(C, C);

    const container = builder.build();
    const c = container.resolve(C);

    expect(c).toBeInstanceOf(C);
    expect(c.first).toBeInstanceOf(A);
    expect(c.second).toBeInstanceOf(B);
  });

  it('should handle multi-level automatic dependencies', () => {
    @Injectable()
    class Database {
      constructor() {}
    }

    @Injectable()
    class Repository {
      constructor(public db: Database) {}
    }

    @Injectable()
    class Service {
      constructor(public repo: Repository) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton(Database, Database);
    builder.singleton(Repository, Repository);
    builder.singleton(Service, Service);

    const container = builder.build();
    const service = container.resolve(Service);

    expect(service).toBeInstanceOf(Service);
    expect(service.repo).toBeInstanceOf(Repository);
    expect(service.repo.db).toBeInstanceOf(Database);
  });

  it('should work with transient registrations', () => {
    @Injectable()
    class A {
      constructor() {}
    }

    @Injectable()
    class B {
      constructor(public a: A) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton(A, A);
    builder.transient(B, B);

    const container = builder.build();
    const b1 = container.resolve(B);
    const b2 = container.resolve(B);

    expect(b1).not.toBe(b2);
    expect(b1.a).toBe(b2.a); // A is singleton
  });

  it('should detect cycles with automatic resolution', () => {
    @Injectable()
    class A {
      b: any;
      constructor(b: any) {
        this.b = b;
      }
    }

    @Injectable()
    class B {
      a: any;
      constructor(a: any) {
        this.a = a;
      }
    }

    // Set up the forward references manually using Dep
    const builder = new ContainerBuilder();
    builder.singleton(A, ({ b }) => new A(b), { b: new Dep(B) });
    builder.singleton(B, ({ a }) => new B(a), { a: new Dep(A) });

    expect(() => builder.build()).toThrow(ContainerError);
    expect(() => builder.build()).toThrow(/Cycle/);
  });

  it('should allow mixing automatic and manual registration', () => {
    @Injectable()
    class Config {
      constructor(public value: string) {}
    }

    @Injectable()
    class Service {
      constructor(public config: Config) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton(Config, ({ value }) => new Config(value), { value: 'test-value' });
    builder.singleton(Service, Service);

    const container = builder.build();
    const service = container.resolve(Service);

    expect(service.config.value).toBe('test-value');
  });

  it('should work without @Injectable when using factory functions', () => {
    // No decorator needed when using factory functions with explicit kwargs
    class Database {
      constructor(public url: string) {}
    }

    class Service {
      constructor(public db: Database) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton(Database, ({ url }) => new Database(url), { url: 'postgres://localhost' });
    builder.singleton(Service, ({ db }) => new Service(db), { db: new Dep(Database) });

    const container = builder.build();
    const service = container.resolve(Service);

    expect(service.db.url).toBe('postgres://localhost');
  });
});

describe('Advanced use cases', () => {
  it('should handle complex dependency graphs', () => {
    @Injectable()
    class Database {
      constructor(public url: string) {}
    }

    @Injectable()
    class UserRepository {
      constructor(public db: Database) {}
    }

    @Injectable()
    class AuthService {
      constructor(public userRepo: UserRepository) {}
    }

    @Injectable()
    class Controller {
      constructor(public auth: AuthService) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton(
      Database,
      ({ url }) => new Database(url),
      { url: 'postgres://localhost' }
    );
    builder.singleton(UserRepository, ({ db }) => new UserRepository(db), {
      db: new Dep(Database),
    });
    builder.singleton(AuthService, ({ userRepo }) => new AuthService(userRepo), {
      userRepo: new Dep(UserRepository),
    });
    builder.singleton(Controller, ({ auth }) => new Controller(auth), {
      auth: new Dep(AuthService),
    });

    const container = builder.build();
    const controller = container.resolve(Controller);

    expect(controller.auth.userRepo.db.url).toBe('postgres://localhost');
  });

  it('should support multiple instances with different configurations', () => {
    @Injectable()
    class Logger {
      constructor(public name: string, public level: string) {}
    }

    const builder = new ContainerBuilder();
    builder.singleton(
      'appLogger',
      () => new Logger('app', 'info')
    );
    builder.singleton(
      'dbLogger',
      () => new Logger('database', 'debug')
    );

    const container = builder.build();

    const appLogger = container.resolve('appLogger') as Logger;
    const dbLogger = container.resolve('dbLogger') as Logger;

    expect(appLogger.name).toBe('app');
    expect(appLogger.level).toBe('info');
    expect(dbLogger.name).toBe('database');
    expect(dbLogger.level).toBe('debug');
  });

  it('should support symbol keys', () => {
    const LoggerKey = Symbol('Logger');

    @Injectable()
    class Logger {
      log(msg: string) {
        return msg;
      }
    }

    const builder = new ContainerBuilder();
    builder.singleton(LoggerKey, () => new Logger());

    const container = builder.build();
    const logger = container.resolve(LoggerKey) as Logger;

    expect(logger.log('test')).toBe('test');
  });
});
