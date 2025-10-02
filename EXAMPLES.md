# Examples

## Basic Usage

### Simple Service Registration

```typescript
import 'reflect-metadata';
import { ContainerBuilder, Injectable } from 'independency-ts';

@Injectable()
class Logger {
  log(message: string) {
    console.log(message);
  }
}

const builder = new ContainerBuilder();
builder.singleton(Logger, () => new Logger());

const container = builder.build();
const logger = container.resolve(Logger);
logger.log('Hello, World!');
```

### With Dependencies

```typescript
@Injectable()
class Database {
  constructor(public connectionString: string) {}

  query(sql: string) {
    console.log(`Executing: ${sql}`);
  }
}

@Injectable()
class UserRepository {
  constructor(public db: Database) {}

  findUser(id: number) {
    this.db.query(`SELECT * FROM users WHERE id = ${id}`);
  }
}

const builder = new ContainerBuilder();

builder.singleton(
  Database,
  ({ connectionString }) => new Database(connectionString),
  { connectionString: 'postgres://localhost/mydb' }
);

builder.singleton(
  UserRepository,
  ({ db }) => new UserRepository(db),
  { db: new Dep(Database) }
);

const container = builder.build();
const userRepo = container.resolve(UserRepository);
userRepo.findUser(123);
```

## Advanced Patterns

### Factory Pattern

```typescript
import { Dependency as Dep } from 'independency-ts';

interface IEmailService {
  send(to: string, message: string): void;
}

@Injectable()
class SendGridEmailService implements IEmailService {
  constructor(private apiKey: string) {}

  send(to: string, message: string) {
    console.log(`SendGrid: Sending to ${to}`);
  }
}

@Injectable()
class SMTPEmailService implements IEmailService {
  constructor(private host: string, private port: number) {}

  send(to: string, message: string) {
    console.log(`SMTP: Sending to ${to} via ${this.host}:${this.port}`);
  }
}

// Factory function
function createEmailService(config: any): IEmailService {
  if (config.provider === 'sendgrid') {
    return new SendGridEmailService(config.apiKey);
  } else {
    return new SMTPEmailService(config.smtpHost, config.smtpPort);
  }
}

const builder = new ContainerBuilder();

builder.singleton('emailConfig', () => ({
  provider: 'sendgrid',
  apiKey: 'sk_test_123',
}));

builder.singleton(
  'emailService',
  ({ config }) => createEmailService(config),
  { config: new Dep('emailConfig') }
);

const container = builder.build();
const emailService = container.resolve('emailService') as IEmailService;
emailService.send('user@example.com', 'Hello!');
```

### Multi-Tenant Configuration

```typescript
@Injectable()
class TenantDatabase {
  constructor(
    public tenantId: string,
    public connectionString: string
  ) {}
}

@Injectable()
class TenantService {
  constructor(public db: TenantDatabase) {}

  getData() {
    console.log(`Getting data for tenant ${this.db.tenantId}`);
  }
}

// Create container for each tenant
function createTenantContainer(tenantId: string): Container {
  const builder = new ContainerBuilder();

  builder.singleton(
    TenantDatabase,
    () => new TenantDatabase(
      tenantId,
      `postgres://localhost/tenant_${tenantId}`
    )
  );

  builder.singleton(
    TenantService,
    ({ db }) => new TenantService(db),
    { db: new Dep(TenantDatabase) }
  );

  return builder.build();
}

// Usage
const tenant1Container = createTenantContainer('tenant1');
const tenant2Container = createTenantContainer('tenant2');

const service1 = tenant1Container.resolve(TenantService);
const service2 = tenant2Container.resolve(TenantService);

service1.getData(); // Getting data for tenant tenant1
service2.getData(); // Getting data for tenant tenant2
```

### Configuration-Based Resolution

```typescript
@Injectable()
class Config {
  constructor(
    public cacheEnabled: boolean,
    public cacheType: string
  ) {}
}

@Injectable()
class MemoryCache {
  get(key: string) { return `mem:${key}`; }
}

@Injectable()
class RedisCache {
  get(key: string) { return `redis:${key}`; }
}

@Injectable()
class Service {
  constructor(private cache: any) {}

  getData(key: string) {
    return this.cache.get(key);
  }
}

function createService(container: Container, config: Config): Service {
  if (!config.cacheEnabled) {
    return new Service(null);
  }

  const cacheType = config.cacheType === 'redis' ? RedisCache : MemoryCache;
  const cache = container.resolve(cacheType);
  return new Service(cache);
}

const builder = new ContainerBuilder();

builder.singleton(Config, () => new Config(true, 'redis'));
builder.singleton(MemoryCache, () => new MemoryCache());
builder.singleton(RedisCache, () => new RedisCache());

builder.singleton(
  Service,
  ({ container, config }) => createService(container, config),
  {
    container: new Dep(Container),
    config: new Dep(Config),
  }
);

const container = builder.build();
const service = container.resolve(Service);
console.log(service.getData('key1')); // redis:key1
```

## Testing Examples

### Unit Testing with Mocks

```typescript
@Injectable()
class PaymentGateway {
  charge(amount: number): boolean {
    // Real payment processing
    return true;
  }
}

@Injectable()
class OrderService {
  constructor(private gateway: PaymentGateway) {}

  processOrder(amount: number) {
    if (this.gateway.charge(amount)) {
      return 'Order processed';
    }
    return 'Payment failed';
  }
}

// Production setup
const builder = new ContainerBuilder();
builder.singleton(PaymentGateway, () => new PaymentGateway());
builder.singleton(
  OrderService,
  ({ gateway }) => new OrderService(gateway),
  { gateway: new Dep(PaymentGateway) }
);

const prodContainer = builder.build();

// Test setup
class MockPaymentGateway {
  charge(amount: number): boolean {
    return amount < 1000; // Simulate failure for large amounts
  }
}

const testContainer = prodContainer
  .createTestContainer()
  .withOverriddenSingleton(PaymentGateway, () => new MockPaymentGateway());

// Tests
const testService = testContainer.resolve(OrderService);
console.log(testService.processOrder(100));  // Order processed
console.log(testService.processOrder(2000)); // Payment failed
```

### Integration Testing

```typescript
@Injectable()
class Database {
  constructor(public url: string) {}

  connect() {
    console.log(`Connecting to ${this.url}`);
  }
}

@Injectable()
class UserRepository {
  constructor(private db: Database) {}

  save(user: any) {
    this.db.connect();
    console.log('Saving user...');
  }
}

// Production container
const prodBuilder = new ContainerBuilder();
prodBuilder.singleton(
  Database,
  ({ url }) => new Database(url),
  { url: 'postgres://prod-server/myapp' }
);
prodBuilder.singleton(
  UserRepository,
  ({ db }) => new UserRepository(db),
  { db: new Dep(Database) }
);

const prodContainer = prodBuilder.build();

// Test container with test database
const testContainer = prodContainer
  .createTestContainer()
  .withOverriddenSingleton(
    Database,
    ({ url }) => new Database(url),
    { url: 'postgres://localhost/test_db' }
  );

// Use in tests
const testRepo = testContainer.resolve(UserRepository);
testRepo.save({ name: 'Test User' });
// Output: Connecting to postgres://localhost/test_db
```

### Partial Mocking

```typescript
@Injectable()
class Logger {
  log(msg: string) {
    console.log(`[LOG] ${msg}`);
  }
}

@Injectable()
class EmailService {
  send(to: string, msg: string) {
    console.log(`Email sent to ${to}`);
  }
}

@Injectable()
class NotificationService {
  constructor(
    private logger: Logger,
    private email: EmailService
  ) {}

  notify(user: string, message: string) {
    this.logger.log(`Notifying ${user}`);
    this.email.send(user, message);
  }
}

const builder = new ContainerBuilder();
builder.singleton(Logger, () => new Logger());
builder.singleton(EmailService, () => new EmailService());
builder.singleton(
  NotificationService,
  ({ logger, email }) => new NotificationService(logger, email),
  {
    logger: new Dep(Logger),
    email: new Dep(EmailService),
  }
);

const container = builder.build();

// Override only EmailService for testing
class MockEmailService {
  sent: Array<{ to: string; msg: string }> = [];

  send(to: string, msg: string) {
    this.sent.push({ to, msg });
  }
}

const mockEmail = new MockEmailService();

const testContainer = container
  .createTestContainer()
  .withOverriddenSingleton(EmailService, () => mockEmail);

const service = testContainer.resolve(NotificationService);
service.notify('user@test.com', 'Hello');

// Real logger still works, email is mocked
console.log(mockEmail.sent); // [{ to: 'user@test.com', msg: 'Hello' }]
```

## Real-World Application Structure

```typescript
// config.ts
export class AppConfig {
  constructor(
    public port: number,
    public dbUrl: string,
    public jwtSecret: string
  ) {}
}

// database.ts
@Injectable()
export class Database {
  constructor(private config: AppConfig) {}

  async connect() {
    console.log(`Connecting to ${this.config.dbUrl}`);
  }
}

// repositories/user.repository.ts
@Injectable()
export class UserRepository {
  constructor(private db: Database) {}

  async findById(id: number) {
    await this.db.connect();
    return { id, name: 'John' };
  }
}

// services/auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    private userRepo: UserRepository,
    private config: AppConfig
  ) {}

  async login(username: string, password: string) {
    const user = await this.userRepo.findById(1);
    // Use config.jwtSecret for token generation
    return { token: 'jwt_token', user };
  }
}

// controllers/auth.controller.ts
@Injectable()
export class AuthController {
  constructor(private authService: AuthService) {}

  async handleLogin(req: any, res: any) {
    const result = await this.authService.login(req.body.username, req.body.password);
    res.json(result);
  }
}

// app.ts - Wire everything together
export function createApp() {
  const builder = new ContainerBuilder();

  // Config
  builder.singleton(AppConfig, () => new AppConfig(
    3000,
    process.env.DATABASE_URL || 'postgres://localhost/myapp',
    process.env.JWT_SECRET || 'secret'
  ));

  // Infrastructure
  builder.singleton(
    Database,
    ({ config }) => new Database(config),
    { config: new Dep(AppConfig) }
  );

  // Repositories
  builder.singleton(
    UserRepository,
    ({ db }) => new UserRepository(db),
    { db: new Dep(Database) }
  );

  // Services
  builder.singleton(
    AuthService,
    ({ userRepo, config }) => new AuthService(userRepo, config),
    {
      userRepo: new Dep(UserRepository),
      config: new Dep(AppConfig),
    }
  );

  // Controllers
  builder.singleton(
    AuthController,
    ({ authService }) => new AuthController(authService),
    { authService: new Dep(AuthService) }
  );

  return builder.build();
}

// Usage
const container = createApp();
const authController = container.resolve(AuthController);
```
