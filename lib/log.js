'use strict';

const bunyan = require('bunyan');
const { LoggingBunyan } = require('@google-cloud/logging-bunyan');
const loggingBunyan = new LoggingBunyan({
  projectId: process.env.GCLOUD_PROJECT,
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
