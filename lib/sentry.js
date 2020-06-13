export default Sentry = require("@sentry/node");

Sentry.init({
  dsn: "https://5f5398dfd6b0475ea6061cf39bc4ed03@sentry.io/5178400"
});

// Sentry.configureScope(function(scope) {
//   scope.setTag("service", "my value");
//   scope.setUser({
//     id: 42,
//     email: "john.doe@example.com"
//   });
// });


// const Sentry = require("@sentry/node");
// ...
//       }).catch((error) => Sentry.captureMessage(error));
