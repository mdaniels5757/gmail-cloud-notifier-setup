const bunyan = require('bunyan');
const { LoggingBunyan } = require('@google-cloud/logging-bunyan');
const loggingBunyan = new LoggingBunyan({
  redirectToStdout: true,
  skipParentEntryForCloudRun: true
});
const logger = bunyan.createLogger({
  name: 'gmail-notifier',
  src: true,
  streams: [
    loggingBunyan.stream('debug')
  ]
});

exports.logger = logger;
