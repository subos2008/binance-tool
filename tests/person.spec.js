// jest.spec.js

const Person = require('./person');

describe('Person unit tests', () => {
 let person;

 beforeEach(() => {
   person = new Person('John', 30);
 });

 it('Should be an adult', () => {
   expect(person).toBeDefined();
   expect(person.isAdult()).toBe(true);
 });

 it('Should be a child', () => {
   person.age = 12;
   expect(person).toBeDefined();
   expect(person.isAdult()).toBe(false);
 });

 // ...
});
