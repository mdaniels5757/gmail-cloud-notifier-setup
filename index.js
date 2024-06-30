/**
 * Original: Copyright 2018, Google LLC
 * Modifications: Copyright 2024, Michael Daniels
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const { google } = require('googleapis');
const oauth = require('./lib/oauth');
const gmail = google.gmail({ version: 'v1', auth: oauth.client });
const querystring = require('querystring');
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

/**
 * Request an OAuth 2.0 authorization code
 * Only new users (or those who want to refresh
 * their auth data) need visit this page
 */
exports.oauth2init = (_, res) => {
  // Define OAuth2 scopes
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly'
  ];

  // Generate + redirect to OAuth2 consent form URL
  const authUrl = oauth.client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent' // Required in order to receive a refresh token every time
  });
  return res.redirect(authUrl);
};

/**
 * Get an access token from the authorization code and store token in Datastore
 */
exports.oauth2callback = (req, res) => {
  // Get authorization code from request
  const code = req.query.code;
  // OAuth2: Exchange authorization code for access token
  oauth.client.getToken(code)
    .then((r) => {
      oauth.client.setCredentials(r.tokens);
    })
    .then(() => {
      // Get user email (to use as a Datastore key)
      return gmail.users.getProfile({
        auth: oauth.client,
        userId: 'me'
      });
    })
    .then((profile) => {
      return profile.data.emailAddress;
    })
    .then((emailAddress) => {
      // Store token in Datastore
      return Promise.all([
        emailAddress,
        oauth.saveToken(emailAddress)
      ]);
    })
    .then(([emailAddress, _]) => {
      // Respond to request
      logger.info({ entry: 'Log initialized for ' + emailAddress });
      res.redirect(`/initWatch?emailAddress=${querystring.escape(emailAddress)}`);
    })
    .catch((err) => {
      // Handle error
      logger.error({ entry: err });
      res.status(500).send('Something went wrong; check the logs.');
    });
};

exports.setCron = (req, res) => {
  const { Datastore } = require('@google-cloud/datastore');
  const datastore = new Datastore({ databaseId: 'gmail-notifier' });
  const {CloudSchedulerClient} = require('@google-cloud/scheduler').v1;
  const schedulerClient = new CloudSchedulerClient();
  const {PubSub} = require('@google-cloud/pubsub');
  const pubsub = new PubSub({ projectId: process.env.GCLOUD_PROJECT });

  // Require a valid email address
  if (!req.query.emailAddress) {
    return res.status(400).send('No emailAddress specified.');
  }
  const email = querystring.unescape(req.query.emailAddress);
  if (!email.includes('@')) {
    return res.status(400).send('Invalid emailAddress.');
  }

  // Retrieve the stored OAuth 2.0 access token
  return oauth.fetchToken(email)
    .then(() => {
      return pubsub.createTopic('gmail-notifier-' + emailAddress.substring(0, emailAddress.indexOf("@")));
    })
    .then(() => {
      return schedulerClient.createJob({
        parent: 'projects/' + process.env.GCLOUD_PROJECT + '/locations/' + process.env.GCF_REGION,
        job: {
          description: 'gmail notifier for ' + emailAddress,
          schedule: '*/7 * * * *',
          pubsubTarget: {
            topicName: 'gmail-notifier-' + emailAddress.substring(0, emailAddress.indexOf("@")),
            attributes: {
              emailAddress: emailAddress,
              time: Date.now()
            }
          }
        }
      });
    })
    .then(() => {
      return datastore.save({
        key: datastore.key(['lastRunTime', email]),
        data: {
          lastRunTime: Date.now()
        }
      });
    })
    .then(() => {
      // Respond with status
      res.write('Cron initialized!');
      res.status(200).end();
    })
    .catch((err) => {
      // Handle errors
      logger.error({ entry: err });
      res.status(500).send('Something went wrong; check the logs.');
    });
};