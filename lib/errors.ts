'use strict';

// use like const { OrderTooSmallError } = require("./errors");
// to get autogenerated error classes

/*  ------------------------------------------------------------------------ */

module.exports = subclass(
	/*  Root class                  */

	Error,
	/*  Derived class hierarchy     */

	{
		EEBaseError: {
			ExitNow: {},
			NotImplementedError: {},
			InsufficientBalanceError: {},
			OrderTooSmallError: {}
		}
	}
);

/*  ------------------------------------------------------------------------ */

function subclass(BaseClass:any, classes:any, namespace = {}) {
	for (const [ $class, subclasses ] of Object.entries(classes)) {
		const Class = Object.assign(namespace, {
			/*  By creating a named property, we trick compiler to assign our class constructor function a name.
            Otherwise, all our error constructors would be shown as [Function: Error] in the debugger! And
            the super-useful `e.constructor.name` magic wouldn't work — we then would have no chance to
            obtain a error type string from an error instance programmatically!                               */

			[$class]: class extends BaseClass {
				constructor(message:string) {
					super(message);

					/*  A workaround to make `instanceof` work on custom Error classes in transpiled ES5.
                    See my blog post for the explanation of this hack:

                    https://medium.com/@xpl/javascript-deriving-from-error-properly-8d2f8f315801        */

					this.constructor = Class;
					this.__proto__ = Class.prototype;
					this.message = message;
					this.name = $class;
				}
			}
		})[$class];

		subclass(Class, subclasses, namespace);
	}

	return namespace;
}

/*  ------------------------------------------------------------------------ */
