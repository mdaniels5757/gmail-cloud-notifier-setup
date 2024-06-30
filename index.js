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
const logger = require('./lib/log').logger;

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
  logger.debug({ entry: 'authUrl: ' + authUrl });
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
      logger.info({ entry: 'Auth initialized for ' + emailAddress });
      res.write('Successfully authenticated.' +
        `Do you want to <a href="/setCron?emailAddress=${querystring.escape(emailAddress)}">set the cron job</a> or ` +
        `<a href="/setEditQuery?emailAddress=${querystring.escape(emailAddress)}">set or edit your query</a>?`);
      res.status(200).end();
    })
    .catch((err) => {
      // Handle error
      logger.error({ entry: JSON.stringify(err, null, 4) });
      res.status(500).send('Something went wrong; check the logs.');
    });
};

// This is not secure, but since only I have access to it it's OK.
exports.setCron = (req, res) => {
  const { Datastore } = require('@google-cloud/datastore');
  const datastore = new Datastore({ databaseId: 'gmail-notifier' });
  const { CloudSchedulerClient } = require('@google-cloud/scheduler').v1;
  const schedulerClient = new CloudSchedulerClient({
    projectId: process.env.GCLOUD_PROJECT
  });
  // const { PubSub } = require('@google-cloud/pubsub');
  // const pubsub = new PubSub({ projectId: process.env.GCLOUD_PROJECT });

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
  /* .then(() => {
      logger.debug({ entry: 'Here' });
      // return pubsub.getTopic('gmail-notifier-' + email.substring(0, email.indexOf('@')))
      return pubsub.createTopic('gmail-notifier-' + email.substring(0, email.indexOf('@')))
        .then((topic) => {
          logger.debug({ entry: JSON.stringify(topic, null, 4) });
          return topic;
        });
    }) *//*
    .then((maybeTopic) => {
      logger.debug({ entry: JSON.stringify(maybeTopic, null, 4) });
      if (Object.hasOwn(maybeTopic, 'error')) {
        return pubsub.createTopic('gmail-notifier-' + email.substring(0, email.indexOf('@')));
      } else {
        return maybeTopic;
      }
    }) */
    .then(() => {
      const location = 'projects/' + process.env.GCLOUD_PROJECT + '/locations/' + process.env.GCF_REGION;
      logger.debug({ entry: 'location: ' + location });
      return schedulerClient.createJob({
        parent: location,
        job: {
          description: 'gmail notifier for ' + email,
          schedule: '*/7 * * * *',
          pubsubTarget: {
            topicName: 'projects/' + process.env.GCLOUD_PROJECT + '/topics/gmail-notifier-' + email.substring(0, email.indexOf('@')),
            attributes: {
              emailAddress: email,
              time: Date.now()
            }
          }
        }
      });
    })
    .then((job) => {
      logger.debug({ entry: JSON.stringify(job, null, 4) });
      return datastore.save({
        key: datastore.key(['lastRunTime', email]),
        data: {
          lastRunTime: Date.now()
        }
      });
    })
    .then((datastoreResponse) => {
      logger.debug({ entry: JSON.stringify(datastoreResponse, null, 4) });
      // Respond with status
      res.write('Cron initialized!');
      res.status(200).end();
    })
    .catch((err) => {
      // Handle errors
      logger.error({ entry: JSON.stringify(err, null, 4) });
      res.status(500).send('Something went wrong; check the logs.');
    });
};

// This is not secure, but since only I have access to it it's OK.
exports.setEditQuery = (req, res) => {
  const { Datastore } = require('@google-cloud/datastore');
  const datastore = new Datastore({ databaseId: 'gmail-notifier' });

  if (req.method === 'GET') {
    // Require a valid email address
    if (!req.query.emailAddress) {
      return res.status(400).send('No emailAddress specified.');
    }
    const email = querystring.unescape(req.query.emailAddress);
    if (!email.includes('@')) {
      return res.status(400).send('Invalid emailAddress.');
    }
    oauth.fetchToken(email)
      .then(() => {
        return datastore.get({
          key: datastore.key(['query', email])
        })
          .catch((err) => {
            logger.warn({ entry: JSON.stringify(err, null, 4) });
            return null;
          });
      })
      .then((currentQueryObj) => {
        logger.info({ entry: 'currentQueryObj is ' + JSON.stringify(currentQueryObj, null, 4) });
        if (currentQueryObj == null) {
          res.write('No query for ' + email + ' right now.<br>');
        } else {
          res.write('Current query for <code>' + email + '</code>: <code>' + currentQueryObj.query +
            '</code> (last updated ' + currentQueryObj.queryLastUpdated + ')<br>');
        }
        res.write('<form action="/setEditQuery" method="post">' +
          '<label for="query">Query:</label>' +
          '<input type="text" id="query" name="query">' +
          '<input type="hidden" id="emailAddress"' +
            'name="emailAddress" value="' + email + '">' + '<br>' +
          '<input type="submit" value="Submit">' +
          '</form>'
        );
        res.status(200).end();
      })
      .catch((err) => {
        // Handle errors
        logger.error({ entry: err });
        res.status(500).send('Something went wrong; check the logs.');
      });
  } else if (req.method === 'POST') {
    logger.info({ entry: 'req.body: ' + JSON.stringify(req.body) });
    const email = req.body.emailAddress;
    datastore.save({
      key: datastore.key(['query', email]),
      data: {
        query: req.body.query,
        queryLastUpdated: Date.now()
      }
    })
      .then((datastoreResponse) => {
        logger.info({ entry: 'datastoreResponse: ' + JSON.stringify(datastoreResponse) });
        res.write('Successfully saved query <code>' + req.body.query +
          '</code> for <code>' + req.body.emailAddress + '</code>');
        res.status(200).end();
      })
      .catch((err) => {
        // Handle errors
        logger.error({ entry: err });
        res.status(500).send('Something went wrong; check the logs.');
      });
  } else {
    res.status(405).send('Invalid method: only GET and POST allowed');
  }
};
