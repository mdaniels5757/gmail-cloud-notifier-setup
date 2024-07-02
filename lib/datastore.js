'use strict';

const { Datastore } = require('@google-cloud/datastore');
const datastore = new Datastore({ databaseId: 'gmail-notifier' });
exports.datastore = datastore;
