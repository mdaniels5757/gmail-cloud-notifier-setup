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

const datastore = require('./datastore').datastore;
const { google } = require('googleapis');

const callbackUrl = `https://${process.env.GCF_REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/oauth2callback`;
// Retrieve OAuth2 config
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  callbackUrl
);
exports.client = oauth2Client;

/**
 * Helper function to fetch a user's OAuth 2.0 access token
 * Can fetch current tokens from Datastore, or create new ones
 */
exports.fetchToken = (emailAddress) => {
  return datastore.get(datastore.key(['oauth2Token', emailAddress]))
    .then((tokens) => {
      const t = tokens[0];
      oauth2Client.setCredentials({
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        scope: t.scope,
        expiry_date: t.expiry_date,
        token_type: t.token_type
      });
    });
};

/**
 * Helper function to save an OAuth 2.0 access token to Datastore
 */
exports.saveToken = (emailAddress) => {
  return datastore.save({
    key: datastore.key(['oauth2Token', emailAddress]),
    data: oauth2Client.credentials
  });
};
