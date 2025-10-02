import 'reflect-metadata';

// Without decorator
class A {
  constructor(public x: string) {}
}

// With empty decorator
function Dec() {
  return function(target: any) { return target; };
}

@Dec()
class B {
  constructor(public x: string) {}
}

console.log('A metadata:', Reflect.getMetadata('design:paramtypes', A));
console.log('B metadata:', Reflect.getMetadata('design:paramtypes', B));
