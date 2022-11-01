#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {DependencyReceiverStack} from "../lib/dependency-receiver-stack";
import {DependencySenderStack} from "../lib/dependency-sender-stack";

const app = new cdk.App();

const receiverAccount = app.node.tryGetContext('receiverAccount')
const senderAccount = app.node.tryGetContext('senderAccount')

const region = app.node.tryGetContext('region')

if (!receiverAccount || !senderAccount || !region) {
  throw new Error('Please provide "receiverAccount", "senderAccount", "region" through --context')
}

const receiverStack = new DependencyReceiverStack(app, 'ReceiverStack', {
  env: {account: receiverAccount, region: region},
  senderAccount: senderAccount
})

new DependencySenderStack(app, 'SenderStack', {
  env: {account: senderAccount, region: region},
  receiverAccount: receiverAccount
}).addDependency(receiverStack)
