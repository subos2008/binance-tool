const Sentry = require("@sentry/node");
Sentry.init({
  dsn: "https://5f5398dfd6b0475ea6061cf39bc4ed03@sentry.io/5178400"
});

// const Sentry = require("@sentry/node");
// ...
//       }).catch((error) => Sentry.captureMessage(error));
