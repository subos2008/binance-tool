import * as Sentry from '@sentry/node';

// DEPRICATED! Don't set DSN in options, set SENTRY_DSN in the environment instead.

// Sentry.init({}); I'm guessing init is not needed if we are setting nothing?

export default Sentry

// Sentry.configureScope(function(scope) {
//   scope.setTag("service", "my value");
//   scope.setUser({
//     id: 42,
//     email: "john.doe@example.com"
//   });
// });


// import * as Sentry from '@sentry/node';
// ...
//       }).catch((err) => Sentry.captureMessage(err));
