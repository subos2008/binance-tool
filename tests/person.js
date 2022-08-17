class Person {
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }
 
  isAdult() {
    return this.age >= 18;
  }
 }
 
 module.exports = Person;
